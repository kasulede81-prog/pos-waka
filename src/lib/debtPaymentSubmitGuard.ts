/**
 * DEBT-PAY-01 — prevent the same Pay Debt confirm from minting two payment IDs.
 * `addDebtPayment` is not idempotent (new UUID each call). A React busy flag is
 * too late for double-click; this lock is synchronous.
 *
 * The key is an in-flight / session identity, not a permanent uniqueness rule.
 * The same customer may legitimately pay the same amount later after the lock
 * is released (sheet reopen / account switch).
 *
 * Validation must run before tryBegin (failed validation must not take the lock).
 * Failed mutations release the lock so the cashier can retry.
 * Successful mutations stay locked until the caller releases (sheet reopen /
 * account switch) so a later legitimate payment remains possible.
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
