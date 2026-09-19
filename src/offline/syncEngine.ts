import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { reportSyncIssue } from "../lib/monitoring";
import type { SyncOperation } from "../types";
import { computeSyncBackoffMs, markSyncOpFailed, markSyncOpQuarantined, shouldRetrySyncOp, isQuarantinedSyncOp, SYNC_QUARANTINE_AFTER_ATTEMPTS, QUARANTINED_MAX_ATTEMPTS_ERROR, QUARANTINED_NO_SHOP_ERROR, clearSyncOpQuarantine } from "../lib/autoSync";
import {
  isBlockedBusinessSyncError,
  markSyncOpBlockedBusiness,
  syncProcessLastError,
  syncProcessStatus,
  type SyncProcessResult,
} from "../lib/saleAdjustmentSync";
import { usePosStore } from "../store/usePosStore";
import { sortSyncQueueByPriority } from "../lib/syncQueuePriority";
import { processCloudSyncOperation } from "./cloudSync";
import { appendSyncOperation, readSyncQueue, removeSyncOperation } from "./localDb";
import {
  STALE_RESET_GUARDED_KINDS,
  archiveAndDropStaleResetOps,
  isCreatedBeforeStaleResetCutoff,
  resolveClockSkewMs,
} from "../lib/staleResetOutbox";
import { getActiveShopId } from "./shopScope";
import { inferShopIdFromQueueRow } from "./shopScopeMigration";
import {
  clearBlockedReturnRecoveryAttempts,
  hasBlockedReturnRecoveryAttempt,
  markBlockedReturnRecoveryAttempted,
} from "../lib/blockedReturnRecovery";
import {
  maybeRepairHistoricalSaleHeader,
  verifyHistoricalReturnFollowThrough,
} from "../lib/historicalSaleHeaderRepair";

export { isCreatedBeforeStaleResetCutoff };

export async function enqueueSync(op: Omit<SyncOperation, "attempts"> & { attempts?: number }): Promise<void> {
  const shopId = op.shopId ?? getActiveShopId() ?? undefined;
  const full: SyncOperation = {
    ...op,
    shopId,
    attempts: op.attempts ?? 0,
    lastAttemptAt: op.lastAttemptAt ?? null,
  };
  const enqueueStarted = performance.now();
  await appendSyncOperation(full);
  void import("../lib/syncDiagnostics").then(({ recordEnqueueLatency, recordQueueDepth }) => {
    recordEnqueueLatency(performance.now() - enqueueStarted);
    void readSyncQueue().then((q) => recordQueueDepth(q.length));
  });
  void import("../lib/immediateSync").then(({ scheduleImmediateSyncForKind }) => {
    scheduleImmediateSyncForKind(full.kind, full.payload);
  });
}

/**
 * Best-effort remote push. When Supabase is not configured, ops are retained
 * (local-only mode) so they can sync once cloud is configured.
 * When configured but signed out, ops are retried later.
 */
async function processOne(op: SyncOperation): Promise<SyncProcessResult> {
  if (!hasSupabaseConfig || !supabase) return "retry";

  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return "retry";

  const opShopId = inferShopIdFromQueueRow(op as SyncOperation & { accountKey?: string });
  if (!opShopId) {
    reportSyncIssue("sync_quarantined_no_shop", { kind: op.kind, opId: op.id });
    return { status: "block", lastError: QUARANTINED_NO_SHOP_ERROR };
  }

  const activeShop = getActiveShopId();
  if (activeShop && opShopId !== activeShop) {
    return "retry";
  }

  try {
    const cloud = await import("./cloudSync");
    if (
      "processCloudSyncOperationResult" in cloud &&
      typeof cloud.processCloudSyncOperationResult === "function"
    ) {
      return await cloud.processCloudSyncOperationResult({ ...op, shopId: opShopId });
    }
    return (await processCloudSyncOperation({ ...op, shopId: opShopId })) ? "ack" : "retry";
  } catch {
    return "retry";
  }
}

export async function flushSyncQueue(onProgress?: (done: number, total: number) => void, opts?: { retryQuarantined?: boolean }): Promise<{
  failed: number;
  remaining: number;
  skippedBackoff: number;
}> {
  const { withGlobalSyncMutex } = await import("../lib/globalSyncMutex");
  return withGlobalSyncMutex("flushSyncQueue", () => flushSyncQueueInner(onProgress, opts));
}

export async function flushSyncQueueInner(onProgress?: (done: number, total: number) => void, opts?: { retryQuarantined?: boolean }): Promise<{
  failed: number;
  remaining: number;
  skippedBackoff: number;
}> {
  const repair = await maybeRepairHistoricalSaleHeader();
  if (repair.allowReturnRecovery) {
    clearBlockedReturnRecoveryAttempts();
  }
  // WAKA-06: never process/ACK entity ops while persisted state is still
  // hydrating. A RAM miss during this window is not proof the row is gone.
  if (!usePosStore.getState()._hydrated) {
    const remaining = (await readSyncQueue()).length;
    return { failed: 0, remaining, skippedBackoff: remaining };
  }
  const queue = sortSyncQueueByPriority(await readSyncQueue());
  const dayCloses = usePosStore.getState().dayCloses;
  const cloudMod = await import("./cloudSync");
  const probeBlockedReturnRecovery =
    typeof cloudMod.probeBlockedReturnRecovery === "function"
      ? cloudMod.probeBlockedReturnRecovery
      : async () => false;
  const retryQuarantined = opts?.retryQuarantined === true;
  const activeShop = getActiveShopId();

  // Admin-reset safety net: an op queued BEFORE a shop reset (a pending
  // product edit/create, sale, or stock/inventory mutation) must never be
  // pushed once the shop's server-side business data has been wiped —
  // `pushProductCatalogToCloud` upserts on `id`, so pushing a pre-reset
  // product op would literally re-insert the row the reset just deleted.
  // Only fetched when the queue actually holds one of these kinds, so a
  // normal flush with no pending business mutations costs nothing extra.
  let staleResetCutoff: string | null = null;
  // P1 remediation (financial certification audit, P1#2): when the
  // reset-signal lookup itself fails/times out, guarded-kind ops must be
  // held back (neither pushed nor dropped) rather than defaulting to "safe
  // to push" — see `resolveStaleResetGuardState`'s docstring for why the old
  // fail-open behavior here was a real resurrection gap.
  let guardedKindsBlocked = false;
  // Corrects for this device's clock running behind (or ahead of) the
  // server's: `op.createdAt` is stamped from the client clock at enqueue
  // time, while `staleResetCutoff` is the server's own clock. Compared
  // directly, a device whose clock runs meaningfully behind the server could
  // have a genuinely POST-reset mutation's `createdAt` still read as earlier
  // than the reset moment — silently dropping a legitimate, never-replayed
  // transaction. Only fetched in this same rare (queue-has-guarded-kinds AND
  // a signal is outstanding) path, via the existing `fetchShopServerNow`
  // primitive already used for this identical class of problem (WAKA-05).
  // Falls back to the original uncorrected comparison if the server-time
  // fetch itself fails — never blocks the flush on this.
  let clockSkewMs = 0;
  // Ops dropped (archived first) by the guard this cycle. A guarded op that predates the cutoff but could NOT be
  // archived is HELD, never deleted: the archive is the only evidence of an unsynced pre-reset sale.
  const archivedStaleOpIds = new Set<string>();
  if (activeShop && queue.some((op) => STALE_RESET_GUARDED_KINDS.has(op.kind))) {
    const { resolveStaleResetGuardState } = await import("../lib/shopRecoverySignals");
    const guardState = await resolveStaleResetGuardState(activeShop);
    if (guardState.status === "signal") {
      staleResetCutoff = guardState.cutoff;
      clockSkewMs = await resolveClockSkewMs();
      try {
        const archived = await archiveAndDropStaleResetOps({
          shopId: activeShop,
          cutoff: guardState.cutoff,
          clockSkewMs,
          reason: "flush_guard",
          queue,
        });
        for (const id of archived.droppedOpIds) archivedStaleOpIds.add(id);
      } catch (err) {
        reportSyncIssue("sync_stale_reset_archive_failed", { message: err instanceof Error ? err.message : "unknown" });
      }
    } else if (guardState.status === "unknown") {
      guardedKindsBlocked = true;
    }
  }

  const ready: SyncOperation[] = [];
  let skippedBackoff = 0;
  for (const op of queue) {
    const opShopId = inferShopIdFromQueueRow(op as SyncOperation & { accountKey?: string });
    if (activeShop && opShopId && opShopId !== activeShop) {
      continue;
    }
    if (archivedStaleOpIds.has(op.id)) continue; // archived + removed above
    if (
      staleResetCutoff &&
      STALE_RESET_GUARDED_KINDS.has(op.kind) &&
      isCreatedBeforeStaleResetCutoff(op.createdAt, staleResetCutoff, clockSkewMs)
    ) {
      // could not be archived: hold it (neither push a pre-reset mutation nor destroy the only copy)
      reportSyncIssue("sync_op_held_stale_pre_reset_unarchived", { kind: op.kind, opId: op.id });
      continue;
    }
    if (guardedKindsBlocked && STALE_RESET_GUARDED_KINDS.has(op.kind)) {
      // Reset-signal lookup failed/timed out this cycle — cannot confirm
      // this op is safe to push (nor safe to drop). Hold it in the queue
      // untouched; a later flush will re-check and resolve it.
      reportSyncIssue("sync_op_held_reset_signal_unknown", { kind: op.kind, opId: op.id });
      continue;
    }
    if (op.attempts >= SYNC_QUARANTINE_AFTER_ATTEMPTS && !isQuarantinedSyncOp(op)) {
      await appendSyncOperation(markSyncOpQuarantined(op, QUARANTINED_MAX_ATTEMPTS_ERROR));
      continue;
    }
    if (isQuarantinedSyncOp(op)) {
      if (retryQuarantined) {
        ready.push(clearSyncOpQuarantine(op));
      }
      continue;
    }
    if (isBlockedBusinessSyncError(op.lastError)) {
      if (op.kind === "pending_returns" && !hasBlockedReturnRecoveryAttempt(op.id)) {
        const recoverable = await probeBlockedReturnRecovery(op);
        if (recoverable) {
          markBlockedReturnRecoveryAttempted(op.id);
          ready.push(op);
          continue;
        }
      }
      continue;
    }
    if (!shouldRetrySyncOp(op, Date.now(), dayCloses)) {
      skippedBackoff += 1;
      continue;
    }
    ready.push(op);
  }

  const total = queue.length;
  void import("../lib/syncDiagnostics").then(({ recordQueueDepth }) => {
    recordQueueDepth(total);
  });
  let failed = 0;
  let done = skippedBackoff;
  const { mapPool } = await import("../lib/asyncPool");
  const { SYNC_QUEUE_FLUSH_CONCURRENCY } = await import("../lib/syncTiming");
  const { markSyncOpWaitingForSale, partitionSaleBeforeAdjustment } = await import("../lib/saleAdjustmentSync");
  const { saleUploads, other } = partitionSaleBeforeAdjustment(ready);

  const processReady = async (op: SyncOperation): Promise<boolean> => {
    try {
      // OBS-1 D2 — sale queue-drain attempt (fire-and-forget; never awaited).
      if (op.kind === "pending_sales" || op.kind === "sale") {
        void import("../lib/syncDiagnostics")
          .then((m) => {
            try {
              m.recordSalePushQueueAttempt();
            } catch {
              /* isolated */
            }
          })
          .catch(() => {});
      }
      const result = await processOne(op);
      const status = syncProcessStatus(result);
      if (status === "ack") {
        await removeSyncOperation(op.id);
      } else if (status === "wait") {
        if (op.attempts < SYNC_QUARANTINE_AFTER_ATTEMPTS) {
          await appendSyncOperation(markSyncOpWaitingForSale(op));
        }
      } else if (status === "block") {
        const blockedError = syncProcessLastError(result);
        await appendSyncOperation(
          blockedError === QUARANTINED_NO_SHOP_ERROR
            ? markSyncOpQuarantined(op, QUARANTINED_NO_SHOP_ERROR)
            : markSyncOpBlockedBusiness(op, blockedError),
        );
      } else {
        failed += 1;
        void import("../lib/syncDiagnostics").then(({ recordSyncRetry }) => {
          recordSyncRetry(op.kind, op.attempts + 1);
        });
        const nextAttempts = op.attempts + 1;
        if (nextAttempts >= SYNC_QUARANTINE_AFTER_ATTEMPTS) {
          await appendSyncOperation(markSyncOpQuarantined(op, QUARANTINED_MAX_ATTEMPTS_ERROR));
        } else {
          const { syncOpEntityId, takeClosedBusinessDatePark } = await import("../lib/closedBusinessDateSync");
          await appendSyncOperation({
            ...markSyncOpFailed(op, status === "retry" ? syncProcessLastError(result) : undefined),
            ...takeClosedBusinessDatePark(syncOpEntityId(op)),
          });
        }
      }
    } catch {
      failed += 1;
      reportSyncIssue("sync_flush_error", { kind: op.kind, attempts: op.attempts + 1 });
      try {
        if (op.attempts + 1 >= SYNC_QUARANTINE_AFTER_ATTEMPTS) {
          await appendSyncOperation(markSyncOpQuarantined(op, QUARANTINED_MAX_ATTEMPTS_ERROR));
        } else {
          await appendSyncOperation(markSyncOpFailed(op));
        }
      } catch {
        reportSyncIssue("sync_queue_corrupt", { kind: op.kind });
      }
      return false;
    }
    done += 1;
    onProgress?.(done, total);
    return true;
  };

  await mapPool(saleUploads, SYNC_QUEUE_FLUSH_CONCURRENCY, processReady);
  await mapPool(other, SYNC_QUEUE_FLUSH_CONCURRENCY, processReady);

  if (repair.allowReturnRecovery) {
    await verifyHistoricalReturnFollowThrough();
  }

  const remaining = (await readSyncQueue()).length;
  return { failed, remaining, skippedBackoff };
}

/** Next retry delay for the most-backed-off op (for diagnostics). */
export function nextQueueRetryMs(queue: SyncOperation[], nowMs = Date.now()): number | null {
  let minWait: number | null = null;
  for (const op of queue) {
    if (isBlockedBusinessSyncError(op.lastError) || isQuarantinedSyncOp(op)) continue;
    if (shouldRetrySyncOp(op, nowMs)) continue;
    const last = op.lastAttemptAt ? new Date(op.lastAttemptAt).getTime() : nowMs;
    const wait = computeSyncBackoffMs(op.attempts) - (nowMs - last);
    if (wait > 0) minWait = minWait == null ? wait : Math.min(minWait, wait);
  }
  return minWait;
}
