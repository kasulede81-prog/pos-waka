import type { DayCloseSummary, SyncOperation } from "../types";
import { shouldRetryClosedBusinessDateOp } from "./businessDateLock";
import { isBlockedBusinessSyncError, sanitizeStoredSyncError } from "./saleAdjustmentSync";

export const SYNC_BACKOFF_BASE_MS = 2_000;
export const SYNC_BACKOFF_CAP_MS = 300_000;
/** WAKA-11 — after this many failed attempts the row is quarantined, not retried forever. */
export const SYNC_QUARANTINE_AFTER_ATTEMPTS = 100;
export const QUARANTINED_MAX_ATTEMPTS_ERROR = "quarantined_max_attempts";
export const QUARANTINED_NO_SHOP_ERROR = "quarantined_no_shop";

/** Exponential backoff capped at 5 minutes. */
export function computeSyncBackoffMs(attempts: number): number {
  const exp = Math.min(Math.max(0, attempts), 8);
  return Math.min(SYNC_BACKOFF_CAP_MS, SYNC_BACKOFF_BASE_MS * 2 ** exp);
}

export function isQuarantinedSyncError(error?: string | null): boolean {
  const token = String(error ?? "").trim();
  return token === QUARANTINED_MAX_ATTEMPTS_ERROR || token === QUARANTINED_NO_SHOP_ERROR;
}

export function isQuarantinedSyncOp(op: SyncOperation): boolean {
  return Boolean(op.quarantinedAt) || isQuarantinedSyncError(op.lastError);
}

/** True when enough time has passed since the last failed attempt. */
export function shouldRetrySyncOp(
  op: SyncOperation,
  nowMs = Date.now(),
  dayCloses?: DayCloseSummary[],
): boolean {
  if (isQuarantinedSyncOp(op)) return false;
  if (op.attempts >= SYNC_QUARANTINE_AFTER_ATTEMPTS) return false;
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

/** Keep the durable row, stop auto-retry, preserve the reason for diagnosis. */
export function markSyncOpQuarantined(op: SyncOperation, reason: string): SyncOperation {
  const token = isQuarantinedSyncError(reason) ? reason : QUARANTINED_MAX_ATTEMPTS_ERROR;
  return {
    ...op,
    attempts: Math.max(op.attempts, SYNC_QUARANTINE_AFTER_ATTEMPTS),
    lastAttemptAt: new Date().toISOString(),
    lastError: token,
    quarantinedAt: op.quarantinedAt ?? new Date().toISOString(),
  };
}

export function clearSyncOpQuarantine(op: SyncOperation): SyncOperation {
  return {
    ...op,
    lastError: isQuarantinedSyncError(op.lastError) ? null : op.lastError,
    lastAttemptAt: null,
    quarantinedAt: null,
    attempts: 0,
  };
}

export type QueueHealth = "healthy" | "degraded" | "backing_off" | "blocked" | "quarantined";

export function isUnhealthyQueueHealth(health: QueueHealth): boolean {
  return health === "degraded" || health === "backing_off" || health === "blocked" || health === "quarantined";
}

/** Derive queue health from pending ops for trust indicators. */
export function deriveQueueHealth(queue: SyncOperation[]): QueueHealth {
  if (queue.length === 0) return "healthy";
  if (queue.some((op) => isQuarantinedSyncOp(op))) return "quarantined";
  const retryable = queue.filter((op) => !isBlockedBusinessSyncError(op.lastError));
  const waitingBackoff = retryable.some((op) => !shouldRetrySyncOp(op));
  if (waitingBackoff) return "backing_off";
  const maxAttempts = retryable.reduce((max, op) => Math.max(max, op.attempts), 0);
  if (maxAttempts >= 3 || retryable.length > 20) return "degraded";
  if (retryable.length < queue.length) return "blocked";
  return "healthy";
}
