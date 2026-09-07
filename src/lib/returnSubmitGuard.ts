/**
 * SALE-RET-01 — prevent the same return confirm from minting two return IDs.
 * `returnProduct` is not idempotent (new UUID each call). A React busy flag is
 * too late for double-click; this lock is synchronous.
 *
 * Validation must run before tryBegin (failed validation must not take the lock).
 * Failed mutations release the lock so the cashier can retry.
 * Successful mutations stay locked until the caller releases (modal reopen /
 * account switch) so a later legitimate return remains possible.
 */

import { onActiveAccountKeyChange } from "../offline/accountScope";

export type ReturnSubmitLockInput = {
  accountKey: string;
  saleId: string | null;
  productId: string;
  quantity: number;
  refundAmountUgx: number;
  reason: string;
};

const inFlight = new Set<string>();

export function returnSubmitLockKey(input: ReturnSubmitLockInput): string {
  return [
    input.accountKey,
    input.saleId ?? "unlinked",
    input.productId,
    String(input.quantity),
    String(input.refundAmountUgx),
    input.reason,
  ].join("::");
}

export function tryBeginReturnSubmit(key: string): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function releaseReturnSubmit(key: string): void {
  inFlight.delete(key);
}

export function releaseReturnSubmitsForAccount(accountKey: string): void {
  const prefix = `${accountKey}::`;
  for (const key of [...inFlight]) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
}

export function resetReturnSubmitLocksForTests(): void {
  inFlight.clear();
}

export function returnSubmitLockHeld(key: string): boolean {
  return inFlight.has(key);
}

onActiveAccountKeyChange(() => {
  inFlight.clear();
});
