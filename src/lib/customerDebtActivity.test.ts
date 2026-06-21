import { describe, expect, it } from "vitest";
import type { Customer, DebtPayment, Sale } from "../types";
import {
  buildCreditActivityIndex,
  buildCreditActivityTimeline,
  creditActivityTimelineFromIndex,
} from "./customerDebtActivity";

function mkSale(i: number, customerId: string): Sale {
  return {
    id: `s-${i}`,
    status: "completed",
    createdAt: `2026-06-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
    lines: [],
    subtotalUgx: 10_000,
    totalUgx: 10_000,
    cashPaidUgx: 0,
    debtUgx: 10_000,
    customerId,
    estimatedProfitUgx: 2_000,
    pendingSync: false,
  };
}

describe("customerDebtActivity index", () => {
  it("buildCreditActivityTimeline matches indexed timeline", () => {
    const customers: Customer[] = [
      { id: "c1", name: "A", phone: "", location: "", createdAt: "", version: 1, debtBalanceUgx: 0 },
      { id: "c2", name: "B", phone: "", location: "", createdAt: "", version: 1, debtBalanceUgx: 0 },
    ];
    const sales = [mkSale(1, "c1"), mkSale(2, "c1"), mkSale(3, "c2")];
    const debtPayments: DebtPayment[] = [
      { id: "p1", customerId: "c1", amountUgx: 5_000, createdAt: "2026-06-05T12:00:00.000Z" },
    ];
    const index = buildCreditActivityIndex(sales, debtPayments);
    for (const c of customers) {
      expect(creditActivityTimelineFromIndex(c.id, index)).toEqual(
        buildCreditActivityTimeline(c.id, sales, debtPayments),
      );
    }
  });

  it("indexes 20k customers x 100k sales in under 500ms", () => {
    const sales: Sale[] = [];
    for (let i = 0; i < 100_000; i += 1) {
      sales.push(mkSale(i, `c-${i % 20_000}`));
    }
    const start = performance.now();
    const index = buildCreditActivityIndex(sales, []);
    const ms = performance.now() - start;
    expect(index.salesByCustomer.size).toBe(20_000);
    expect(ms).toBeLessThan(500);
  });
});
