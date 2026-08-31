/**
 * DEBT-PAYMENT-CONCURRENCY-1.0 — client payload / decision + queue identity.
 */
import { describe, expect, it } from "vitest";
import type { DebtPayment } from "../types";
import {
  buildDebtPaymentRpcPayload,
  debtPaymentQueuePayload,
  interpretDebtPaymentRpcResult,
} from "./debtPaymentPush";
import { getCompletedFinancials } from "./financialMetrics";
import type { Product, Sale } from "../types";

const DAY = "2026-08-30";

function payment(id: string): DebtPayment {
  return {
    id,
    customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    amountUgx: 40_000,
    createdAt: `${DAY}T12:00:00.000Z`,
  };
}

describe("DEBT-PAYMENT-CONCURRENCY-1.0 client push helpers", () => {
  it("T14 offline queue payload preserves payment ID", () => {
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const q1 = debtPaymentQueuePayload(id);
    const q2 = debtPaymentQueuePayload(id);
    expect(q1.paymentId).toBe(id);
    expect(q2.paymentId).toBe(id);
    expect(q1).toEqual(q2);
  });

  it("T15 retry payload never regenerates payment ID / omits expected_balance", () => {
    const p = payment("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    const a = buildDebtPaymentRpcPayload(p);
    const b = buildDebtPaymentRpcPayload(p);
    expect(a.payment_id).toBe(p.id);
    expect(b.payment_id).toBe(p.id);
    expect(a).toEqual(b);
    expect("expected_balance_ugx" in a).toBe(false);
  });

  it("success and idempotent ACK without rebasing", () => {
    expect(interpretDebtPaymentRpcResult({ ok: true, new_balance_ugx: 60_000 })).toEqual({
      ack: true,
      applyBalanceUgx: 60_000,
      idempotent: false,
    });
    expect(
      interpretDebtPaymentRpcResult({ ok: true, idempotent: true, new_balance_ugx: 60_000 }),
    ).toEqual({
      ack: true,
      applyBalanceUgx: 60_000,
      idempotent: true,
    });
  });

  it("stale_balance and overpay fail closed (no rebase retry permission)", () => {
    expect(interpretDebtPaymentRpcResult({ ok: false, error: "stale_balance" })).toEqual({
      ack: false,
      error: "stale_balance",
    });
    expect(interpretDebtPaymentRpcResult({ ok: false, error: "amount_exceeds_balance" })).toEqual({
      ack: false,
      error: "amount_exceeds_balance",
    });
  });

  it("T16 debt payment is not revenue (canonical financials unchanged by payment rows)", () => {
    const products: Product[] = [
      {
        id: "p1",
        name: "Item",
        sellingPricePerUnitUgx: 10_000,
        costPricePerUnitUgx: 1_000,
        stockOnHand: 10,
        baseUnit: "pcs",
        sellingMode: "unit",
        category: "General",
        sku: "",
        minimumStockAlert: 1,
        updatedAt: `${DAY}T09:00:00.000Z`,
        version: 1,
      },
    ];
    const sale: Sale = {
      id: "sale-1",
      status: "completed",
      createdAt: `${DAY}T10:00:00.000Z`,
      updatedAt: `${DAY}T10:00:00.000Z`,
      subtotalUgx: 100_000,
      totalUgx: 100_000,
      cashPaidUgx: 0,
      debtUgx: 100_000,
      estimatedProfitUgx: 90_000,
      paymentMethod: "credit",
      customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      lines: [
        {
          id: "l1",
          productId: "p1",
          name: "Item",
          quantity: 1,
          unitPriceUgx: 100_000,
          unitCostUgx: 10_000,
          estimatedProfitUgx: 90_000,
          inputMode: "quantity",
          updatedAt: `${DAY}T10:00:00.000Z`,
          lineTotalUgx: 100_000,
        },
      ],
      pendingSync: false,
      lastSyncError: null,
    };
    const before = getCompletedFinancials([sale], [], products, { day: DAY });
    // DebtPayment existence does not feed revenue helpers.
    const after = getCompletedFinancials([sale], [], products, { day: DAY });
    expect(before.revenueUgx).toBe(100_000);
    expect(after.revenueUgx).toBe(before.revenueUgx);
    expect(before.debtIssuedUgx).toBe(100_000);
    expect(after.cashCollectedUgx).toBe(0);
  });
});
