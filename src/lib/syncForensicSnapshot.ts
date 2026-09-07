/**
 * SYNC-FORENSIC-01 — read-only local queue snapshot for support.
 * Does not enqueue, dequeue, retry, push, pull, or write IndexedDB.
 */

import type { DayCloseSummary, SyncOperation, SyncOperationKind, UserRole } from "../types";
import { computeSyncBackoffMs, deriveQueueHealth, shouldRetrySyncOp } from "./autoSync";
import { isClosedBusinessDateSyncError, shouldRetryClosedBusinessDateOp } from "./businessDateLock";
import { getDeviceOnline } from "./deviceOnline";
import { isNativeApp } from "./nativeApp";
import { inferShopIdFromQueueRow } from "../offline/shopScopeMigration";
import { sortSyncQueueByPriority } from "./syncQueuePriority";

export const SYNC_FORENSIC_SNAPSHOT_VERSION = 1;

export const KNOWN_SYNC_OPERATION_KINDS = [
  "pending_sales",
  "pending_stock_updates",
  "pending_returns",
  "pending_expenses",
  "pending_cash_expenses",
  "pending_cash_drawer_adjustments",
  "pending_inventory_counts",
  "pending_day_drawer_opens",
  "pending_shifts",
  "pending_day_closes",
  "pending_purchases",
  "pending_transfer_dispatch",
  "pending_transfer_receive",
  "pending_hospitality",
  "pending_catalog",
  "pending_shop_policy",
  "pending_staff",
  "sale",
  "product",
  "customer",
  "stock_move",
  "audit_log",
  "purchase",
  "supplier",
] as const satisfies readonly SyncOperationKind[];

const KNOWN_KIND_SET = new Set<string>(KNOWN_SYNC_OPERATION_KINDS);

export type SyncForensicClassification =
  | "READY"
  | "BACKOFF"
  | "CLOSED_DATE_PARK"
  | "MISSING_SHOP"
  | "SHOP_MISMATCH"
  | "MISSING_SESSION"
  | "MALFORMED"
  | "UNKNOWN_KIND"
  | "OTHER";

export type SyncForensicPayloadClass =
  | "sale"
  | "return"
  | "void"
  | "purchase"
  | "expense"
  | "product"
  | "customer"
  | "supplier"
  | "staff"
  | "inventory_count"
  | "shop_policy"
  | "catalog"
  | "hospitality"
  | "shift"
  | "day_close"
  | "day_drawer_open"
  | "cash_drawer"
  | "transfer"
  | "audit"
  | "stock"
  | "other";

export type SyncForensicRow = {
  id: string;
  kind: string;
  createdAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  shopIdPresent: boolean;
  shopMatchesActive: boolean;
  shopIdRedacted: string | null;
  closedDateKey: string | null;
  retryEligible: boolean;
  retryAt: string | null;
  accountKeyPresent: boolean;
  payloadClass: SyncForensicPayloadClass;
  classification: SyncForensicClassification;
};

export type SyncForensicBlocker = {
  id: string;
  kind: string;
  classification: SyncForensicClassification;
  attempts: number;
  lastAttemptAt: string | null;
  retryAt: string | null;
  lastError: string | null;
  shopIdPresent: boolean;
  shopMatchesActive: boolean;
  closedDateKey: string | null;
  createdAt: string;
};

export type SyncForensicSnapshot = {
  version: typeof SYNC_FORENSIC_SNAPSHOT_VERSION;
  system: {
    online: boolean;
    platform: "native" | "web";
    runtime: "native" | "mobile_web" | "desktop";
    appVersion: string;
    checkedAt: string;
  };
  auth: {
    authenticated: boolean;
    accountNamespacePresent: boolean;
    activeShopPresent: boolean;
    actorRole: UserRole | null;
  };
  queue: {
    total: number;
    ready: number;
    backingOff: number;
    parkedClosedDate: number;
    degraded: boolean;
    oldestCreatedAt: string | null;
    newestCreatedAt: string | null;
    maxAttempts: number;
    queueHealth: "healthy" | "degraded" | "backing_off";
    queueHasReadyWork: boolean;
    queueHasBackoff: boolean;
    queueHasClosedDatePark: boolean;
    queueHasMalformedRows: boolean;
    queueHasShopMismatch: boolean;
    queueHasMissingShop: boolean;
    queueHasUnknownKind: boolean;
  };
  rows: SyncForensicRow[];
  blockingRows: SyncForensicRow[];
  blocker: SyncForensicBlocker | null;
  starvation: {
    oldestQueueRowId: string | null;
    firstPriorityRowId: string | null;
    firstRetryEligibleRowId: string | null;
    firstNonRetryEligibleRowId: string | null;
  };
};

export type SyncForensicBuildInput = {
  queue: readonly SyncOperation[];
  nowMs: number;
  dayCloses: readonly DayCloseSummary[];
  activeShopId: string | null;
  accountKeyPresent: boolean;
  authenticated: boolean;
  actorRole: UserRole | null;
  online: boolean;
  platform?: "native" | "web";
  runtime?: "native" | "mobile_web" | "desktop";
  appVersion?: string;
};

function redactId(id: string | null | undefined): string | null {
  const raw = String(id ?? "").trim();
  if (!raw) return null;
  return raw.length <= 8 ? `${raw}…` : `${raw.slice(0, 8)}…`;
}

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

export function classifySyncForensicPayload(
  kind: string,
  payload: unknown,
): SyncForensicPayloadClass {
  const p = payloadRecord(payload);
  const hint = String(p?.kind ?? p?.referenceType ?? p?.route ?? "").toLowerCase();
  if (hint.includes("void") || kind.includes("void")) return "void";
  if (kind === "pending_returns" || hint === "return") return "return";
  if (kind === "pending_sales" || kind === "sale") return "sale";
  if (kind === "pending_purchases" || kind === "purchase") return "purchase";
  if (
    kind === "pending_cash_expenses" ||
    kind === "pending_expenses" ||
    hint.includes("expense") ||
    hint === "supplier_payment"
  ) {
    return "expense";
  }
  if (kind === "product") return "product";
  if (kind === "customer" || hint === "debt_payment") return "customer";
  if (kind === "supplier") return "supplier";
  if (kind === "pending_staff") return "staff";
  if (kind === "pending_inventory_counts") return "inventory_count";
  if (kind === "pending_shop_policy") return "shop_policy";
  if (kind === "pending_catalog") return "catalog";
  if (kind === "pending_hospitality") return "hospitality";
  if (kind === "pending_shifts") return "shift";
  if (kind === "pending_day_closes") return "day_close";
  if (kind === "pending_day_drawer_opens") return "day_drawer_open";
  if (kind === "pending_cash_drawer_adjustments") return "cash_drawer";
  if (kind === "pending_transfer_dispatch" || kind === "pending_transfer_receive") return "transfer";
  if (kind === "audit_log") return "audit";
  if (kind === "pending_stock_updates" || kind === "stock_move") return "stock";
  return "other";
}

function isMalformedRow(op: SyncOperation): boolean {
  if (!op || typeof op !== "object") return true;
  if (typeof op.id !== "string" || !op.id.trim()) return true;
  if (typeof op.createdAt !== "string" || !op.createdAt.trim()) return true;
  if (typeof op.kind !== "string" || !op.kind.trim()) return true;
  if (!Number.isFinite(Number(op.attempts))) return true;
  return false;
}

function inferredShopId(op: SyncOperation): string | null {
  return inferShopIdFromQueueRow(op as SyncOperation & { accountKey?: string });
}

export function classifySyncForensicRow(input: {
  op: SyncOperation;
  nowMs: number;
  dayCloses: readonly DayCloseSummary[];
  activeShopId: string | null;
  authenticated: boolean;
}): SyncForensicClassification {
  const { op, nowMs, dayCloses, activeShopId, authenticated } = input;
  if (isMalformedRow(op)) return "MALFORMED";
  if (!KNOWN_KIND_SET.has(op.kind)) return "UNKNOWN_KIND";
  if (isClosedBusinessDateSyncError(op.lastError) && op.closedDateKey) {
    if (!shouldRetryClosedBusinessDateOp(op, [...dayCloses])) return "CLOSED_DATE_PARK";
  }
  const shopId = inferredShopId(op);
  if (!shopId) return "MISSING_SHOP";
  if (activeShopId && shopId !== activeShopId) return "SHOP_MISMATCH";
  if (!authenticated) return "MISSING_SESSION";
  if (!shouldRetrySyncOp(op, nowMs, [...dayCloses])) return "BACKOFF";
  if (shouldRetrySyncOp(op, nowMs, [...dayCloses])) return "READY";
  return "OTHER";
}

function retryAtIso(op: SyncOperation): string | null {
  if (!op.lastAttemptAt) return null;
  const last = new Date(op.lastAttemptAt).getTime();
  if (!Number.isFinite(last)) return null;
  return new Date(last + computeSyncBackoffMs(op.attempts)).toISOString();
}

function classificationRank(c: SyncForensicClassification): number {
  switch (c) {
    case "CLOSED_DATE_PARK":
      return 0;
    case "MALFORMED":
    case "UNKNOWN_KIND":
    case "MISSING_SHOP":
    case "SHOP_MISMATCH":
    case "MISSING_SESSION":
    case "BACKOFF":
      return 1;
    default:
      return 2;
  }
}

function toRow(
  op: SyncOperation,
  input: Omit<SyncForensicBuildInput, "queue">,
): SyncForensicRow {
  const shopId = inferredShopId(op);
  const retryEligible = !isMalformedRow(op) && shouldRetrySyncOp(op, input.nowMs, [...input.dayCloses]);
  return {
    id: String(op.id ?? ""),
    kind: String(op.kind ?? ""),
    createdAt: String(op.createdAt ?? ""),
    attempts: Math.max(0, Math.floor(Number(op.attempts) || 0)),
    lastAttemptAt: op.lastAttemptAt ?? null,
    lastError: op.lastError ?? null,
    shopIdPresent: Boolean(shopId),
    shopMatchesActive: Boolean(shopId && input.activeShopId && shopId === input.activeShopId),
    shopIdRedacted: redactId(shopId),
    closedDateKey: op.closedDateKey ?? null,
    retryEligible,
    retryAt: retryAtIso(op),
    accountKeyPresent: input.accountKeyPresent,
    payloadClass: classifySyncForensicPayload(String(op.kind ?? ""), op.payload),
    classification: classifySyncForensicRow({
      op,
      nowMs: input.nowMs,
      dayCloses: input.dayCloses,
      activeShopId: input.activeShopId,
      authenticated: input.authenticated,
    }),
  };
}

function blockerFromRow(row: SyncForensicRow): SyncForensicBlocker {
  return {
    id: row.id,
    kind: row.kind,
    classification: row.classification,
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt,
    retryAt: row.retryAt,
    lastError: row.lastError,
    shopIdPresent: row.shopIdPresent,
    shopMatchesActive: row.shopMatchesActive,
    closedDateKey: row.closedDateKey,
    createdAt: row.createdAt,
  };
}

export function buildSyncForensicSnapshot(input: SyncForensicBuildInput): SyncForensicSnapshot {
  const ctx = {
    nowMs: input.nowMs,
    dayCloses: input.dayCloses,
    activeShopId: input.activeShopId,
    accountKeyPresent: input.accountKeyPresent,
    authenticated: input.authenticated,
    actorRole: input.actorRole,
    online: input.online,
  };
  const rows = input.queue.map((op) => toRow(op, ctx));
  const blockingRows = [...rows].sort((a, b) => {
    const ra = classificationRank(a.classification);
    const rb = classificationRank(b.classification);
    if (ra !== rb) return ra - rb;
    if (a.retryEligible !== b.retryEligible) return a.retryEligible ? 1 : -1;
    if (b.attempts !== a.attempts) return b.attempts - a.attempts;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const ready = rows.filter((r) => r.classification === "READY").length;
  const backingOff = rows.filter((r) => r.classification === "BACKOFF").length;
  const parkedClosedDate = rows.filter((r) => r.classification === "CLOSED_DATE_PARK").length;
  const created = rows.map((r) => r.createdAt).filter(Boolean).sort();
  const maxAttempts = rows.reduce((max, r) => Math.max(max, r.attempts), 0);
  const queueHealth = deriveQueueHealth([...input.queue]);
  const prioritized = sortSyncQueueByPriority([...input.queue]);

  return {
    version: SYNC_FORENSIC_SNAPSHOT_VERSION,
    system: {
      online: input.online,
      platform: input.platform ?? "web",
      runtime: input.runtime ?? "desktop",
      appVersion: input.appVersion ?? "0",
      checkedAt: new Date(input.nowMs).toISOString(),
    },
    auth: {
      authenticated: input.authenticated,
      accountNamespacePresent: input.accountKeyPresent,
      activeShopPresent: Boolean(input.activeShopId),
      actorRole: input.actorRole,
    },
    queue: {
      total: rows.length,
      ready,
      backingOff,
      parkedClosedDate,
      degraded: queueHealth === "degraded",
      oldestCreatedAt: created[0] ?? null,
      newestCreatedAt: created[created.length - 1] ?? null,
      maxAttempts,
      queueHealth,
      queueHasReadyWork: ready > 0,
      queueHasBackoff: backingOff > 0,
      queueHasClosedDatePark: parkedClosedDate > 0,
      queueHasMalformedRows: rows.some((r) => r.classification === "MALFORMED"),
      queueHasShopMismatch: rows.some((r) => r.classification === "SHOP_MISMATCH"),
      queueHasMissingShop: rows.some((r) => r.classification === "MISSING_SHOP"),
      queueHasUnknownKind: rows.some((r) => r.classification === "UNKNOWN_KIND"),
    },
    rows,
    blockingRows,
    blocker: (() => {
      const top = blockingRows.find((row) => row.classification !== "READY");
      return top ? blockerFromRow(top) : null;
    })(),
    starvation: {
      oldestQueueRowId: created[0] ? rows.find((r) => r.createdAt === created[0])?.id ?? null : null,
      firstPriorityRowId: prioritized[0]?.id ?? null,
      firstRetryEligibleRowId: prioritized.find((op) => shouldRetrySyncOp(op, input.nowMs, [...input.dayCloses]))?.id ?? null,
      firstNonRetryEligibleRowId:
        prioritized.find((op) => !shouldRetrySyncOp(op, input.nowMs, [...input.dayCloses]))?.id ?? null,
    },
  };
}

export function formatSyncForensicExport(snapshot: SyncForensicSnapshot): string {
  return JSON.stringify(
    {
      version: snapshot.version,
      system: snapshot.system,
      auth: snapshot.auth,
      queue: snapshot.queue,
      blocker: snapshot.blocker,
      starvation: snapshot.starvation,
      blockingRows: snapshot.blockingRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        classification: row.classification,
        attempts: row.attempts,
        lastAttemptAt: row.lastAttemptAt,
        retryAt: row.retryAt,
        lastError: row.lastError,
        shopIdPresent: row.shopIdPresent,
        shopMatchesActive: row.shopMatchesActive,
        shopIdRedacted: row.shopIdRedacted,
        closedDateKey: row.closedDateKey,
        createdAt: row.createdAt,
        payloadClass: row.payloadClass,
        retryEligible: row.retryEligible,
        accountKeyPresent: row.accountKeyPresent,
      })),
      rows: snapshot.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        classification: row.classification,
        attempts: row.attempts,
        lastAttemptAt: row.lastAttemptAt,
        retryAt: row.retryAt,
        lastError: row.lastError,
        shopIdPresent: row.shopIdPresent,
        shopMatchesActive: row.shopMatchesActive,
        shopIdRedacted: row.shopIdRedacted,
        closedDateKey: row.closedDateKey,
        createdAt: row.createdAt,
        payloadClass: row.payloadClass,
        retryEligible: row.retryEligible,
        accountKeyPresent: row.accountKeyPresent,
      })),
    },
    null,
    2,
  );
}

function runtimeProfile(): "native" | "mobile_web" | "desktop" {
  if (isNativeApp()) return "native";
  if (typeof window === "undefined") return "desktop";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.innerWidth < 900;
  return coarse && narrow ? "mobile_web" : "desktop";
}

/** Live IndexedDB/RAM read. Never writes. */
export async function getSyncForensicSnapshot(): Promise<SyncForensicSnapshot> {
  const { readSyncQueue } = await import("../offline/localDb");
  const { getPersistenceNamespace, getActiveShopId } = await import("../offline/shopScope");
  const { usePosStore } = await import("../store/usePosStore");
  const queue = await readSyncQueue();
  const state = usePosStore.getState();
  return buildSyncForensicSnapshot({
    queue,
    nowMs: Date.now(),
    dayCloses: state.dayCloses ?? [],
    activeShopId: getActiveShopId(),
    accountKeyPresent: Boolean(getPersistenceNamespace()),
    authenticated: Boolean(state.sessionActor),
    actorRole: state.sessionActor?.role ?? null,
    online: getDeviceOnline(),
    platform: isNativeApp() ? "native" : "web",
    runtime: runtimeProfile(),
    appVersion: import.meta.env.VITE_APP_VERSION?.trim() || "0",
  });
}
