/**
 * CASH-SUP-01 — prevent the same Pay Supplier confirm from minting two payment IDs.
 * `addSupplierPayment` is not idempotent (new UUID each call). A React busy flag is
 * too late for double-click; this lock is synchronous.
 *
 * The key is an in-flight / session identity, not a permanent uniqueness rule.
 * The same supplier may legitimately receive the same amount later after the lock
 * is released (form reopen / account switch).
 *
 * Validation must run before tryBegin (failed validation must not take the lock).
 * Failed mutations release the lock so the cashier can retry.
 * Successful mutations stay locked until the caller releases (form reopen /
 * account switch) so a later legitimate payment remains possible.
 */

import { onActiveAccountKeyChange } from "../offline/accountScope";

export type SupplierPaymentSubmitLockInput = {
  accountKey: string;
  supplierId: string;
  amountUgx: number;
};

const inFlight = new Set<string>();

export function supplierPaymentSubmitLockKey(input: SupplierPaymentSubmitLockInput): string {
  return [input.accountKey, input.supplierId, String(input.amountUgx)].join("::");
}

export function tryBeginSupplierPaymentSubmit(key: string): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function releaseSupplierPaymentSubmit(key: string): void {
  inFlight.delete(key);
}

export function releaseSupplierPaymentSubmitsForAccount(accountKey: string): void {
  const prefix = `${accountKey}::`;
  for (const key of [...inFlight]) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
}

export function resetSupplierPaymentSubmitLocksForTests(): void {
  inFlight.clear();
}

export function supplierPaymentSubmitLockHeld(key: string): boolean {
  return inFlight.has(key);
}

onActiveAccountKeyChange(() => {
  inFlight.clear();
});
