import type { DayCloseSummary, SyncOperation } from "../types";
import { shouldRetryClosedBusinessDateOp } from "./businessDateLock";
import { isBlockedBusinessSyncError, sanitizeStoredSyncError } from "./saleAdjustmentSync";

export const SYNC_BACKOFF_BASE_MS = 2_000;
export const SYNC_BACKOFF_CAP_MS = 300_000;

/** Exponential backoff capped at 5 minutes. */
export function computeSyncBackoffMs(attempts: number): number {
  const exp = Math.min(Math.max(0, attempts), 8);
  return Math.min(SYNC_BACKOFF_CAP_MS, SYNC_BACKOFF_BASE_MS * 2 ** exp);
}

/** True when enough time has passed since the last failed attempt. */
export function shouldRetrySyncOp(
  op: SyncOperation,
  nowMs = Date.now(),
  dayCloses?: DayCloseSummary[],
): boolean {
  if (isBlockedBusinessSyncError(op.lastError)) return false;
  if (!shouldRetryClosedBusinessDateOp(op, dayCloses)) return false;
  if (op.lastError === "waiting_for_sale") return true;
  if (!op.lastAttemptAt) return true;
  const last = new Date(op.lastAttemptAt).getTime();
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= computeSyncBackoffMs(op.attempts);
}

export function markSyncOpFailed(op: SyncOperation, lastError?: string | null): SyncOperation {
  const next: SyncOperation = {
    ...op,
    attempts: op.attempts + 1,
    lastAttemptAt: new Date().toISOString(),
  };
  const sanitized = sanitizeStoredSyncError(lastError);
  if (sanitized) next.lastError = sanitized;
  return next;
}

export type QueueHealth = "healthy" | "degraded" | "backing_off" | "blocked";

/** Derive queue health from pending ops for trust indicators. */
export function deriveQueueHealth(queue: SyncOperation[]): QueueHealth {
  if (queue.length === 0) return "healthy";
  const retryable = queue.filter((op) => !isBlockedBusinessSyncError(op.lastError));
  const waitingBackoff = retryable.some((op) => !shouldRetrySyncOp(op));
  if (waitingBackoff) return "backing_off";
  const maxAttempts = retryable.reduce((max, op) => Math.max(max, op.attempts), 0);
  if (maxAttempts >= 3 || retryable.length > 20) return "degraded";
  if (retryable.length < queue.length) return "blocked";
  return "healthy";
}
