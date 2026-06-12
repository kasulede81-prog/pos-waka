import { describe, expect, it } from "vitest";
import type { DebtPayment, Product, ReturnRecord, Sale, ShiftRecord } from "../types";
import {
  getDrawerCashForDay,
  sumDebtPaymentsDuringShift,
  sumDebtPaymentsOnDay,
} from "./cashReconciliation";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { shiftExpectedCash, shiftExpectedCashLabelParts } from "./saleAdjustments";

const DAY = "2026-05-31";

function sale(partial: Partial<Sale> & Pick<Sale, "status" | "totalUgx">): Sale {
  return {
    id: crypto.randomUUID(),
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:00:00.000Z`,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    estimatedProfitUgx: partial.totalUgx,
    lines: [
      {
        id: crypto.randomUUID(),
        productId: "prod-1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: partial.totalUgx,
        unitCostUgx: 1000,
        estimatedProfitUgx: partial.totalUgx - 1000,
        inputMode: "quantity",
        updatedAt: `${DAY}T10:00:00.000Z`,
        lineTotalUgx: partial.totalUgx,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

const products: Product[] = [
  {
    id: "prod-1",
    name: "Item",
    sellingPricePerUnitUgx: 10000,
    costPricePerUnitUgx: 1000,
    stockOnHand: 50,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 5,
    updatedAt: `${DAY}T09:00:00.000Z`,
    version: 1,
  },
];

function payment(amountUgx: number, at = `${DAY}T14:00:00.000Z`): DebtPayment {
  return {
    id: crypto.randomUUID(),
    customerId: "cust-1",
    amountUgx,
    createdAt: at,
  };
}

describe("debt cash reconciliation", () => {
  it("sumDebtPaymentsOnDay totals payments on Kampala day", () => {
    const payments = [payment(20_000, `${DAY}T10:00:00.000Z`), payment(15_000, `${DAY}T18:00:00.000Z`), payment(5_000, "2026-06-01T08:00:00.000Z")];
    expect(sumDebtPaymentsOnDay(payments, DAY)).toBe(35_000);
  });

  it("getDrawerCashForDay includes debt payments in expected drawer cash", () => {
    const completed = sale({ status: "completed", totalUgx: 100_000, cashPaidUgx: 60_000, debtUgx: 40_000 });
    const pending = sale({ status: "pending", totalUgx: 200_000, cashPaidUgx: 0, debtUgx: 0 });
    const payments = [payment(25_000)];
    const drawer = getDrawerCashForDay([completed, pending], [], products, payments, DAY, 10_000);

    expect(drawer.revenueUgx).toBe(100_000);
    expect(drawer.cashFromSalesUgx).toBe(60_000);
    expect(drawer.debtCollectedUgx).toBe(25_000);
    expect(drawer.expectedDrawerCashUgx).toBe(75_000);
    expect(drawer.refundsUgx).toBe(0);
  });

  it("linked same-day return does not double-subtract when sale header is adjusted", () => {
    const completed = sale({ status: "completed", totalUgx: 100_000, cashPaidUgx: 60_000, debtUgx: 40_000 });
    const returns: ReturnRecord[] = [
      {
        id: crypto.randomUUID(),
        saleId: completed.id,
        productId: "prod-1",
        productName: "Item",
        quantity: 1,
        refundAmountUgx: 5_000,
        reason: "other" as const,
        actorUserId: "u1",
        actorName: "Owner",
        shiftId: null,
        createdAt: `${DAY}T12:00:00.000Z`,
      },
    ];
    const adjusted = { ...completed, ...reduceSaleTotalsByAmount(completed, 5_000) };
    const drawer = getDrawerCashForDay([adjusted], returns, products, [payment(25_000)], DAY, 10_000);
    expect(adjusted.cashPaidUgx).toBe(55_000);
    expect(drawer.expectedDrawerCashUgx).toBe(70_000);
  });

  it("external unlinked return reduces expected drawer cash", () => {
    const completed = sale({ status: "completed", totalUgx: 60_000, cashPaidUgx: 60_000, debtUgx: 0 });
    const returns: ReturnRecord[] = [
      {
        id: crypto.randomUUID(),
        saleId: null,
        productId: "prod-1",
        productName: "Item",
        quantity: 1,
        refundAmountUgx: 5_000,
        reason: "other" as const,
        actorUserId: "u1",
        actorName: "Owner",
        shiftId: null,
        createdAt: `${DAY}T12:00:00.000Z`,
      },
    ];
    const drawer = getDrawerCashForDay([completed], returns, products, [], DAY);
    expect(drawer.expectedDrawerCashUgx).toBe(55_000);
  });

  it("shift expected cash after void/return already in estimatedCashUgx", () => {
    const shift: ShiftRecord = {
      id: "sh-1",
      actorUserId: "u1",
      role: "cashier",
      startAt: `${DAY}T08:00:00.000Z`,
      endAt: null,
      salesTotalUgx: 60_000,
      debtTotalUgx: 0,
      refundsUgx: 5_000,
      estimatedCashUgx: 55_000,
      debtPaymentsTotalUgx: 20_000,
      voidsTotalUgx: 0,
      returnsTotalUgx: 5_000,
    };
    expect(shiftExpectedCash(shift)).toBe(75_000);
    const parts = shiftExpectedCashLabelParts(shift);
    expect(parts.debtPayments).toBe(20_000);
    expect(parts.expected).toBe(75_000);
    expect(parts.sales).toBe(60_000);
  });

  it("sumDebtPaymentsDuringShift respects shift window", () => {
    const shift: ShiftRecord = {
      id: "sh-1",
      actorUserId: "u1",
      role: "cashier",
      startAt: `${DAY}T08:00:00.000Z`,
      endAt: `${DAY}T18:00:00.000Z`,
      salesTotalUgx: 0,
      debtTotalUgx: 0,
      refundsUgx: 0,
      estimatedCashUgx: 0,
    };
    const payments = [payment(10_000, `${DAY}T12:00:00.000Z`), payment(5_000, `${DAY}T19:00:00.000Z`)];
    expect(sumDebtPaymentsDuringShift(payments, shift)).toBe(10_000);
  });

  it("pending sales do not inflate drawer cash", () => {
    const pendingOnly = sale({ status: "pending", totalUgx: 500_000, cashPaidUgx: 0, debtUgx: 0 });
    const drawer = getDrawerCashForDay([pendingOnly], [], products, [], DAY);
    expect(drawer.expectedDrawerCashUgx).toBe(0);
    expect(drawer.revenueUgx).toBe(0);
  });
});
