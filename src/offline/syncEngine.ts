import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { reportSyncIssue } from "../lib/monitoring";
import type { SyncOperation } from "../types";
import { computeSyncBackoffMs, markSyncOpFailed, shouldRetrySyncOp } from "../lib/autoSync";
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
import { getActiveShopId } from "./shopScope";
import { inferShopIdFromQueueRow } from "./shopScopeMigration";
import {
  clearBlockedReturnRecoveryAttempts,
  hasBlockedReturnRecoveryAttempt,
  markBlockedReturnRecoveryAttempted,
  readLastBlockedReturnProbe,
} from "../lib/blockedReturnRecovery";
import {
  maybeRepairHistoricalSaleHeader,
  verifyHistoricalReturnFollowThrough,
} from "../lib/historicalSaleHeaderRepair";

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
    return "retry";
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

export async function flushSyncQueue(onProgress?: (done: number, total: number) => void): Promise<{
  failed: number;
  remaining: number;
  skippedBackoff: number;
}> {
  const { withGlobalSyncMutex } = await import("../lib/globalSyncMutex");
  return withGlobalSyncMutex("flushSyncQueue", () => flushSyncQueueInner(onProgress));
}

export async function flushSyncQueueInner(onProgress?: (done: number, total: number) => void): Promise<{
  failed: number;
  remaining: number;
  skippedBackoff: number;
}> {
  const repair = await maybeRepairHistoricalSaleHeader();
  if (repair.allowReturnRecovery) {
    clearBlockedReturnRecoveryAttempts();
  }
  const queue = sortSyncQueueByPriority(await readSyncQueue());
  const dayCloses = usePosStore.getState().dayCloses;
  const cloudMod = await import("./cloudSync");
  const probeBlockedReturnRecovery =
    typeof cloudMod.probeBlockedReturnRecovery === "function"
      ? cloudMod.probeBlockedReturnRecovery
      : async () => false;
  const ready: SyncOperation[] = [];
  let skippedBackoff = 0;
  for (const op of queue) {
    if (isBlockedBusinessSyncError(op.lastError)) {
      if (op.kind === "pending_returns" && !hasBlockedReturnRecoveryAttempt(op.id)) {
        const recoverable = await probeBlockedReturnRecovery(op);
        const probe = readLastBlockedReturnProbe();
        if (recoverable) {
          markBlockedReturnRecoveryAttempted(op.id);
          ready.push(op);
          continue;
        }
        if (probe?.blocker === "ceiling" || probe?.blocker === "select_empty") {
          markBlockedReturnRecoveryAttempted(op.id);
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
        if (op.attempts < 100) {
          await appendSyncOperation(markSyncOpWaitingForSale(op));
        }
      } else if (status === "block") {
        await appendSyncOperation(markSyncOpBlockedBusiness(op, syncProcessLastError(result)));
      } else {
        failed += 1;
        void import("../lib/syncDiagnostics").then(({ recordSyncRetry }) => {
          recordSyncRetry(op.kind, op.attempts + 1);
        });
        if (op.attempts < 100) {
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
      if (op.attempts < 100) {
        try {
          await appendSyncOperation(markSyncOpFailed(op));
        } catch {
          reportSyncIssue("sync_queue_corrupt", { kind: op.kind });
        }
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
    if (isBlockedBusinessSyncError(op.lastError)) continue;
    if (shouldRetrySyncOp(op, nowMs)) continue;
    const last = op.lastAttemptAt ? new Date(op.lastAttemptAt).getTime() : nowMs;
    const wait = computeSyncBackoffMs(op.attempts) - (nowMs - last);
    if (wait > 0) minWait = minWait == null ? wait : Math.min(minWait, wait);
  }
  return minWait;
}
