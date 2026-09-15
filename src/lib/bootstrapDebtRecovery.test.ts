import { describe, expect, it } from "vitest";
import type { Customer, DebtPayment, Sale } from "../types";
import { reconcileCustomersForBootstrapRecovery } from "./bootstrapDebtRecovery";
import { reconcileCustomerDebtBalance } from "./customerDebtReconciliation";

const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function customer(balance: number): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Alice",
    phone: "",
    location: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
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

describe("bootstrapDebtRecovery", () => {
  it("corrects metadata balance using ledger when sales and payments hydrated", () => {
    const sales = [creditSale(100_000)];
    const payments: DebtPayment[] = [
      { id: "pay-1", customerId: CUSTOMER_ID, amountUgx: 40_000, createdAt: "2026-06-11T11:00:00.000Z" },
    ];
    const remote = customer(100_000);

    const merged = reconcileCustomersForBootstrapRecovery([remote], sales, payments);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.debtBalanceUgx).toBe(60_000);

    const rec = reconcileCustomerDebtBalance(merged[0]!, sales, payments);
    expect(rec.healthy).toBe(true);
  });

  it("matches incremental mergeCustomerFromCloudPull ledger result", () => {
    const sales = [creditSale(50_000)];
    const payments: DebtPayment[] = [];
    const remote = customer(80_000);

    const bootstrap = reconcileCustomersForBootstrapRecovery([remote], sales, payments);
    expect(bootstrap[0]!.debtBalanceUgx).toBe(50_000);
  });

  it("leaves customers unchanged when no sales or payments", () => {
    const remote = customer(25_000);
    const merged = reconcileCustomersForBootstrapRecovery([remote], [], []);
    expect(merged[0]!.debtBalanceUgx).toBe(25_000);
  });
});
