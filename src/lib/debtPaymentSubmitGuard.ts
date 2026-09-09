/**
 * DEBT-PAY-01 / R7 — prevent the same Pay Debt confirm from minting two payment IDs.
 * `addDebtPayment` is not idempotent (new UUID each call). A React busy flag is
 * too late for double-click; this lock is synchronous.
 *
 * The key is an in-flight identity, not a permanent uniqueness rule. Overlapping
 * submits of the same customer+amount are rejected. The lock is released when
 * the protected submission finishes (success or failure) so a later legitimate
 * payment is not blocked until the sheet reopens. Account switch still clears
 * leftover keys.
 *
 * Validation must run before tryBegin (failed validation must not take the lock).
 */

import { onActiveAccountKeyChange } from "../offline/accountScope";

export type DebtPaymentSubmitLockInput = {
  accountKey: string;
  customerId: string;
  amountUgx: number;
};

const inFlight = new Set<string>();

export function debtPaymentSubmitLockKey(input: DebtPaymentSubmitLockInput): string {
  return [input.accountKey, input.customerId, String(input.amountUgx)].join("::");
}

export function tryBeginDebtPaymentSubmit(key: string): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function releaseDebtPaymentSubmit(key: string): void {
  inFlight.delete(key);
}

export function releaseDebtPaymentSubmitsForAccount(accountKey: string): void {
  const prefix = `${accountKey}::`;
  for (const key of [...inFlight]) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
}

export function resetDebtPaymentSubmitLocksForTests(): void {
  inFlight.clear();
}

export function debtPaymentSubmitLockHeld(key: string): boolean {
  return inFlight.has(key);
}

onActiveAccountKeyChange(() => {
  inFlight.clear();
});
