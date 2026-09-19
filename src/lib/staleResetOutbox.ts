/**
 * Admin-reset safety net — stale pre-reset outbox handling with a durable evidence archive.
 *
 * PROBLEM (confirmed on shop 1a110d2e, 2026-09-16 .. 09-19): an admin business-data reset hard-deletes the shop's
 * server data and publishes `force_full_resync_at`. A device that was offline / holding unsynced business
 * mutations queued BEFORE the reset must never push them (that would resurrect deleted rows). Two paths existed:
 *   1. the flush guard (syncEngine): only fires while the signal is still UNACKNOWLEDGED, and it deleted the ops
 *      without leaving any trace;
 *   2. the boot gate (applyAdminForceFullResync): pulls + ACKNOWLEDGES the signal but did NOT touch the queue.
 *      After that ACK the flush guard is inert, and the authoritative full-pull deliberately KEEPS a local sale that
 *      still has a pending queue op — so the pre-reset sale was pushed afterwards (resurrection).
 *
 * FIX: both paths call `archiveAndDropStaleResetOps`, which
 *   - selects guarded-kind ops created before the cutoff (clock-skew corrected) plus adjustment ops (void / return)
 *     that reference a dropped sale, and every local sale still marked `pendingSync` that predates the cutoff,
 *   - writes them to a durable archive in IndexedDB (`kv` key `stale_reset_archive`) FIRST,
 *   - only then removes the ops from the queue.
 * If the archive cannot be written nothing is removed (fail safe: hold, never destroy evidence).
 * Nothing is ever replayed automatically; the archive is for manual, classified recovery.
 */

import type { Sale, SyncOperation } from "../types";
import { readKv, writeKv } from "../offline/localDb";
import { readSyncQueue, removeSyncOperation } from "../offline/localDb";
import { inferShopIdFromQueueRow } from "../offline/shopScopeMigration";
import { reportSyncIssue } from "./monitoring";
import { forensicAdjustmentSaleId } from "./saleAdjustmentSync";

/** Business-data kinds that must never be pushed after an admin reset if they predate it. */
export const STALE_RESET_GUARDED_KINDS = new Set<SyncOperation["kind"]>([
  "product",
  "sale",
  "pending_sales",
  "pending_stock_updates",
  "stock_move",
  "customer",
]);

export const STALE_RESET_ARCHIVE_KEY = "stale_reset_archive";
const MAX_ARCHIVE_ENTRIES = 20;

export type StaleResetArchiveEntry = {
  archivedAt: string;
  reason: "boot_gate" | "flush_guard";
  shopId: string | null;
  /** server-clock timestamp of the reset that made these records stale */
  cutoff: string;
  operations: SyncOperation[];
  /** local sale bodies (own device data) for the dropped ops + orphan pending sales */
  sales: Sale[];
};

export type StaleResetArchiveResult = {
  archivedOps: number;
  archivedSales: number;
  droppedOpIds: string[];
  droppedSaleIds: string[];
};

/**
 * True when `createdAt` (a client-clock timestamp) predates `cutoff` (a server-clock timestamp), after correcting
 * for this device's known clock skew. Falls back to a plain string comparison when either value does not parse.
 */
export function isCreatedBeforeStaleResetCutoff(createdAt: string, cutoff: string, clockSkewMs: number): boolean {
  const createdMs = Date.parse(createdAt);
  const cutoffMs = Date.parse(cutoff);
  if (!Number.isFinite(createdMs) || !Number.isFinite(cutoffMs)) {
    return createdAt < cutoff;
  }
  return createdMs + clockSkewMs < cutoffMs;
}

/** server time minus device time (ms); 0 when the server time cannot be fetched (never blocks). */
export async function resolveClockSkewMs(): Promise<number> {
  try {
    const { fetchShopServerNow } = await import("./serverNow");
    const deviceNowMs = Date.now();
    const serverNowIso = await fetchShopServerNow().catch(() => null);
    const serverNowMs = serverNowIso ? Date.parse(serverNowIso) : NaN;
    return Number.isFinite(serverNowMs) ? serverNowMs - deviceNowMs : 0;
  } catch {
    return 0;
  }
}

function saleIdOfSaleOp(op: SyncOperation): string | null {
  const p = op.payload && typeof op.payload === "object" ? (op.payload as Record<string, unknown>) : null;
  if (!p) return null;
  const id = p.saleId ?? p.sale_id ?? (op.kind === "sale" ? p.id : null);
  return typeof id === "string" && id ? id : null;
}

export async function readStaleResetArchive(): Promise<StaleResetArchiveEntry[]> {
  return (await readKv<StaleResetArchiveEntry[]>(STALE_RESET_ARCHIVE_KEY)) ?? [];
}

export async function archiveAndDropStaleResetOps(input: {
  shopId: string | null;
  cutoff: string;
  /** server minus device clock (ms). Omit to resolve lazily — only when there is something that could be stale. */
  clockSkewMs?: number;
  reason: StaleResetArchiveEntry["reason"];
  /** queue snapshot to use (defaults to the durable queue) */
  queue?: SyncOperation[];
}): Promise<StaleResetArchiveResult> {
  const empty: StaleResetArchiveResult = { archivedOps: 0, archivedSales: 0, droppedOpIds: [], droppedSaleIds: [] };
  const queue = input.queue ?? (await readSyncQueue());

  const inShop = (op: SyncOperation) => {
    const opShop = inferShopIdFromQueueRow(op as SyncOperation & { accountKey?: string });
    return !input.shopId || !opShop || opShop === input.shopId;
  };
  // Cheap pre-check so a boot with an empty / irrelevant outbox never pays for a server-time round trip.
  let hasCandidates = queue.some((op) => STALE_RESET_GUARDED_KINDS.has(op.kind));
  if (!hasCandidates) {
    try {
      const { usePosStore } = await import("../store/usePosStore");
      hasCandidates = ((usePosStore.getState().sales ?? []) as Sale[]).some((s) => s.pendingSync === true);
    } catch {
      hasCandidates = false;
    }
  }
  if (!hasCandidates) return empty;
  const clockSkewMs = input.clockSkewMs ?? (await resolveClockSkewMs());
  const stale = (createdAt: string) => isCreatedBeforeStaleResetCutoff(createdAt, input.cutoff, clockSkewMs);

  const victims = queue.filter(
    (op) => inShop(op) && STALE_RESET_GUARDED_KINDS.has(op.kind) && stale(op.createdAt),
  );
  const droppedSaleIds = new Set<string>();
  for (const op of victims) {
    const id = saleIdOfSaleOp(op);
    if (id && (op.kind === "sale" || op.kind === "pending_sales")) droppedSaleIds.add(id);
  }

  // adjustment ops (void / return / payment) whose sale is being dropped can never be applied: archive them too
  const orphaned = queue.filter((op) => {
    if (!inShop(op) || victims.includes(op) || STALE_RESET_GUARDED_KINDS.has(op.kind)) return false;
    const ref = forensicAdjustmentSaleId(op.payload);
    return !!ref && droppedSaleIds.has(ref);
  });

  // local sales that are still marked unsynced and predate the reset (with or without a queue op)
  let localCandidates: Sale[] = [];
  try {
    const { usePosStore } = await import("../store/usePosStore");
    const all = (usePosStore.getState().sales ?? []) as Sale[];
    localCandidates = all.filter((s) => droppedSaleIds.has(s.id) || (s.pendingSync === true && stale(s.createdAt)));
  } catch {
    /* store unavailable: archive only the queue ops */
  }

  const operations = [...victims, ...orphaned];
  const existing = await readStaleResetArchive();
  // a sale body that is already archived for this reset is not archived again (the flush guard runs every cycle)
  const alreadyArchived = new Set(
    existing.filter((e) => e.cutoff === input.cutoff).flatMap((e) => e.sales.map((s) => s.id)),
  );
  const salesToArchive = localCandidates.filter((s) => !alreadyArchived.has(s.id));
  if (operations.length === 0 && salesToArchive.length === 0) return empty;

  // 1) durable evidence first. If this throws, NOTHING is removed.
  const entry: StaleResetArchiveEntry = {
    archivedAt: new Date().toISOString(),
    reason: input.reason,
    shopId: input.shopId,
    cutoff: input.cutoff,
    operations,
    sales: salesToArchive,
  };
  await writeKv(STALE_RESET_ARCHIVE_KEY, [entry, ...existing].slice(0, MAX_ARCHIVE_ENTRIES));
  // writeKv silently no-ops without an active account namespace: read the entry back before trusting it
  const verify = await readStaleResetArchive();
  if (!verify.some((e) => e.archivedAt === entry.archivedAt && e.cutoff === entry.cutoff)) {
    throw new Error("stale_reset_archive_not_persisted");
  }

  // 2) only now drop the ops from the outbox
  for (const op of operations) {
    await removeSyncOperation(op.id);
    reportSyncIssue("sync_op_archived_stale_pre_reset", { kind: op.kind, opId: op.id, reason: input.reason });
  }

  return {
    archivedOps: operations.length,
    archivedSales: salesToArchive.length,
    droppedOpIds: operations.map((o) => o.id),
    droppedSaleIds: [...new Set(salesToArchive.map((s) => s.id))],
  };
}
