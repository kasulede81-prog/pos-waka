import { describe, expect, it } from "vitest";
import type { Customer, DebtPayment, Sale } from "../types";
import { computeExpectedCustomerDebt } from "./customerDebt";
import {
  mergeCustomerFromCloudPull,
  reconcileCustomerDebtBalance,
  reconcileAllCustomerDebtBalances,
} from "./customerDebtReconciliation";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";

const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function customer(balance: number, version = 1): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Alice",
    phone: "",
    location: "",
    createdAt: "2026-06-01T00:00:00.000Z",
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

describe("customerDebtReconciliation", () => {
  it("reconcileCustomerDebtBalance matches computeExpectedCustomerDebt", () => {
    const sales = [creditSale(100_000)];
    const payments: DebtPayment[] = [
      { id: "p1", customerId: CUSTOMER_ID, amountUgx: 30_000, createdAt: "2026-06-11T12:00:00.000Z" },
    ];
    const c = customer(70_000);
    const rec = reconcileCustomerDebtBalance(c, sales, payments);
    expect(rec.expected).toBe(computeExpectedCustomerDebt(CUSTOMER_ID, sales, payments));
    expect(rec.actual).toBe(70_000);
    expect(rec.delta).toBe(0);
    expect(rec.healthy).toBe(true);
  });

  it("reflects void/return debt reductions via sale.debtUgx", () => {
    const base = creditSale(80_000);
    const adjusted = { ...base, ...reduceSaleTotalsByAmount(base, 20_000) };
    const rec = reconcileCustomerDebtBalance(customer(80_000), [adjusted], []);
    expect(rec.expected).toBe(60_000);
    expect(rec.healthy).toBe(false);
    expect(rec.delta).toBe(20_000);
  });

  it("mergeCustomerFromCloudPull uses ledger when authoritative", () => {
    const sales = [creditSale(50_000)];
    const local = customer(50_000, 2);
    const remote = { ...customer(90_000, 5), updatedAt: "2026-06-12T00:00:00.000Z" };
    const merged = mergeCustomerFromCloudPull(local, remote, sales, [], { ledgerAuthoritative: true });
    expect(merged.debtBalanceUgx).toBe(50_000);
  });

  it("mergeCustomerFromCloudPull keeps last-write-wins when ledger not authoritative", () => {
    const sales = [creditSale(50_000)];
    const local = customer(50_000, 2);
    const remote = { ...customer(90_000, 5), updatedAt: "2026-06-12T00:00:00.000Z" };
    const merged = mergeCustomerFromCloudPull(local, remote, sales, [], { ledgerAuthoritative: false });
    expect(merged.debtBalanceUgx).toBe(90_000);
  });

  it("reconcileAllCustomerDebtBalances lists mismatches", () => {
    const rows = reconcileAllCustomerDebtBalances([customer(100_000)], [creditSale(50_000)], []);
    expect(rows[0]!.healthy).toBe(false);
    expect(rows[0]!.expected).toBe(50_000);
  });
});
