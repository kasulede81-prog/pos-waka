import type { SyncOperation } from "../types";

export const SYNC_BACKOFF_BASE_MS = 2_000;
export const SYNC_BACKOFF_CAP_MS = 300_000;

/** Exponential backoff capped at 5 minutes. */
export function computeSyncBackoffMs(attempts: number): number {
  const exp = Math.min(Math.max(0, attempts), 8);
  return Math.min(SYNC_BACKOFF_CAP_MS, SYNC_BACKOFF_BASE_MS * 2 ** exp);
}

/** True when enough time has passed since the last failed attempt. */
export function shouldRetrySyncOp(op: SyncOperation, nowMs = Date.now()): boolean {
  if (!op.lastAttemptAt) return true;
  const last = new Date(op.lastAttemptAt).getTime();
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= computeSyncBackoffMs(op.attempts);
}

export function markSyncOpFailed(op: SyncOperation): SyncOperation {
  return {
    ...op,
    attempts: op.attempts + 1,
    lastAttemptAt: new Date().toISOString(),
  };
}

export type QueueHealth = "healthy" | "degraded" | "backing_off";

/** Derive queue health from pending ops for trust indicators. */
export function deriveQueueHealth(queue: SyncOperation[]): QueueHealth {
  if (queue.length === 0) return "healthy";
  const maxAttempts = queue.reduce((max, op) => Math.max(max, op.attempts), 0);
  const waitingBackoff = queue.some((op) => !shouldRetrySyncOp(op));
  if (waitingBackoff) return "backing_off";
  if (maxAttempts >= 3 || queue.length > 20) return "degraded";
  return "healthy";
}
