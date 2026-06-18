import { describe, expect, it } from "vitest";
import type { Customer, DebtPayment, Sale } from "../types";
import { verifyCustomerDebtIntegrity } from "./customerDebtIntegrity";
import {
  buildDebtSyncDiagnosticSnapshot,
  runPostSyncDebtValidation,
  getLastDebtSyncDiagnosticSnapshot,
} from "./debtSyncDiagnostics";

const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function customer(balance: number): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Bob",
    phone: "",
    location: "",
    createdAt: "2026-06-01T00:00:00.000Z",
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

describe("debtSyncIntegrity", () => {
  it("post-sync validation is read-only and records diagnostics", () => {
    const customers = [customer(100_000)];
    const sales = [creditSale(50_000)];
    const debtPayments: DebtPayment[] = [];

    const before = customers[0]!.debtBalanceUgx;
    runPostSyncDebtValidation({ customers, sales, debtPayments });
    expect(customers[0]!.debtBalanceUgx).toBe(before);

    const snap = getLastDebtSyncDiagnosticSnapshot();
    expect(snap?.mismatchCount).toBe(1);
    expect(snap?.rows[0]?.expected).toBe(50_000);
    expect(snap?.rows[0]?.actual).toBe(100_000);
  });

  it("verifyCustomerDebtIntegrity without heal does not mutate customers", () => {
    const customers = [customer(80_000)];
    const sales = [creditSale(50_000)];
    const result = verifyCustomerDebtIntegrity(customers, sales, [], { heal: false });
    expect(result.ok).toBe(false);
    expect(result.healedCount).toBe(0);
    expect(customers[0]!.debtBalanceUgx).toBe(80_000);
  });

  it("buildDebtSyncDiagnosticSnapshot flags critical large delta", () => {
    const snap = buildDebtSyncDiagnosticSnapshot({
      customers: [customer(200_000)],
      sales: [creditSale(50_000)],
      debtPayments: [],
    });
    expect(snap.rows[0]?.status).toBe("critical");
  });
});
