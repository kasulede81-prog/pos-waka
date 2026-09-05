/**
 * CASH-POST-02 / CASH-POST-03 — prevent the same cash mutation from running twice.
 * `addCashExpense` and `addCashDrawerAdjustment` are not idempotent (new UUID each call).
 * A React `busy` flag is too late for double-click; this lock is synchronous.
 */

export type CashMutationSubmitLock = { current: boolean };

export function tryBeginCashMutationSubmit(lock: CashMutationSubmitLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseCashMutationSubmit(lock: CashMutationSubmitLock): void {
  lock.current = false;
}

/**
 * Run one cash expense / cash-in / cash-out mutation. A second call while locked is ignored.
 * Validation must happen before this (failed validation must not take the lock).
 * Failed mutations release the lock so the user can retry.
 * Successful mutations stay locked until the caller releases (after form reset / close).
 */
export function submitCashMutationOnce<T extends { ok: boolean }>(
  lock: CashMutationSubmitLock,
  mutate: () => T,
): { started: false } | { started: true; result: T } {
  if (!tryBeginCashMutationSubmit(lock)) return { started: false };
  try {
    const result = mutate();
    if (!result.ok) releaseCashMutationSubmit(lock);
    return { started: true, result };
  } catch (err) {
    releaseCashMutationSubmit(lock);
    throw err;
  }
}
