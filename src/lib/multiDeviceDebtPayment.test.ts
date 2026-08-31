import { describe, expect, it } from "vitest";
import type { Customer, DebtPayment, Sale } from "../types";
import { mergeDebtPaymentsFromCloudPull } from "./debtPaymentRecovery";
import { mergeCustomerFromCloudPull } from "./customerDebtReconciliation";
import { interpretDebtPaymentRpcResult } from "./debtPaymentPush";

const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAY_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAY_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * Mirrors shop_push_debt_payment after migration 174:
 * payment-id idempotency + hard reject when amount > balance (no silent partial).
 */
function applyServerDebtPayment(input: {
  balance: number;
  paymentId: string;
  amount: number;
  seen: Set<string>;
}): { ok: boolean; balance: number; idempotent?: boolean; error?: string } {
  if (input.seen.has(input.paymentId)) {
    return { ok: true, balance: input.balance, idempotent: true };
  }
  if (input.amount <= 0) return { ok: false, balance: input.balance, error: "invalid_amount" };
  if (input.amount > input.balance) {
    return { ok: false, balance: input.balance, error: "amount_exceeds_balance" };
  }
  input.seen.add(input.paymentId);
  return { ok: true, balance: input.balance - input.amount, idempotent: false };
}

function customer(balance: number, version: number, updatedAt: string): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Multi",
    phone: "",
    location: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt,
    version,
    debtBalanceUgx: balance,
  };
}

function creditSale(debtUgx: number): Sale {
  return {
    id: "sale-1",
    status: "completed",
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-11T10:00:00.000Z",
    subtotalUgx: debtUgx,
    totalUgx: debtUgx,
    cashPaidUgx: 0,
    debtUgx,
    estimatedProfitUgx: 0,
    lines: [],
    pendingSync: false,
    lastSyncError: null,
    customerId: CUSTOMER_ID,
  };
}

describe("multiDeviceDebtPayment (post DEBT-PAYMENT-CONCURRENCY-1.0)", () => {
  it("server RPC idempotency prevents duplicate payment application", () => {
    const seen = new Set<string>();
    let balance = 100_000;
    const first = applyServerDebtPayment({ balance, paymentId: PAY_A, amount: 40_000, seen });
    balance = first.balance;
    const replay = applyServerDebtPayment({ balance, paymentId: PAY_A, amount: 40_000, seen });
    expect(replay.idempotent).toBe(true);
    expect(replay.balance).toBe(60_000);
  });

  it("two different payment IDs that fit both apply (serialized concurrency)", () => {
    const seen = new Set<string>();
    let balance = 100_000;
    balance = applyServerDebtPayment({ balance, paymentId: PAY_A, amount: 60_000, seen }).balance;
    const b = applyServerDebtPayment({ balance, paymentId: PAY_B, amount: 40_000, seen });
    expect(b.ok).toBe(true);
    expect(b.balance).toBe(0);
  });

  it("second oversized payment rejects without silent partial apply", () => {
    const seen = new Set<string>();
    let balance = 100_000;
    balance = applyServerDebtPayment({ balance, paymentId: PAY_A, amount: 70_000, seen }).balance;
    const b = applyServerDebtPayment({ balance, paymentId: PAY_B, amount: 70_000, seen });
    expect(b.ok).toBe(false);
    expect(b.error).toBe("amount_exceeds_balance");
    expect(b.balance).toBe(30_000);
  });

  it("client does not treat stale_balance as ACK / rebase permission", () => {
    const d = interpretDebtPaymentRpcResult({ ok: false, error: "stale_balance", server_balance_ugx: 50_000 });
    expect(d.ack).toBe(false);
    expect(d.applyBalanceUgx).toBeUndefined();
  });

  it("two devices converge after payment pull + ledger merge", () => {
    const sales = [creditSale(100_000)];

    const deviceA: DebtPayment[] = [
      { id: PAY_A, customerId: CUSTOMER_ID, amountUgx: 40_000, createdAt: "2026-06-11T11:00:00.000Z" },
    ];
    const deviceB: DebtPayment[] = [
      { id: PAY_B, customerId: CUSTOMER_ID, amountUgx: 30_000, createdAt: "2026-06-11T12:00:00.000Z" },
    ];

    const mergedPayments = mergeDebtPaymentsFromCloudPull(deviceA, deviceB);
    expect(mergedPayments).toHaveLength(2);

    const local = customer(100_000, 3, "2026-06-11T11:30:00.000Z");
    const remote = customer(70_000, 4, "2026-06-11T12:30:00.000Z");
    const mergedCustomer = mergeCustomerFromCloudPull(local, remote, sales, mergedPayments, {
      ledgerAuthoritative: true,
    });
    expect(mergedCustomer.debtBalanceUgx).toBe(30_000);
  });
});
