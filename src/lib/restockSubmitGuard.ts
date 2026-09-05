/**
 * INV-B4 — prevent the same restock submit from running twice.
 * `recordPurchase` is not idempotent (new purchase id each call).
 * A React `busy` flag is too late for double-click; this lock is synchronous.
 */

export type RestockSubmitLock = { current: boolean };

export function tryBeginRestockSubmit(lock: RestockSubmitLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseRestockSubmit(lock: RestockSubmitLock): void {
  lock.current = false;
}

/**
 * Run one restock mutation. A second call while locked is ignored.
 * Validation must happen before this (failed validation must not take the lock).
 * Failed mutations release the lock so the user can retry.
 * Successful mutations stay locked until the caller releases (after form reset / close).
 */
export function submitRestockOnce<T extends { ok: boolean }>(
  lock: RestockSubmitLock,
  mutate: () => T,
): { started: false } | { started: true; result: T } {
  if (!tryBeginRestockSubmit(lock)) return { started: false };
  try {
    const result = mutate();
    if (!result.ok) releaseRestockSubmit(lock);
    return { started: true, result };
  } catch (err) {
    releaseRestockSubmit(lock);
    throw err;
  }
}
