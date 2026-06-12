import { describe, expect, it } from "vitest";
import type { DebtPayment, Product, ReturnRecord, Sale } from "../types";
import { buildCashPositionReport } from "./cashPosition";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { verifyFinancialInvariants } from "./financialInvariants";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { shiftExpectedCash } from "./saleAdjustments";

const DAY = "2026-06-11";
const PRIOR_DAY = "2026-06-10";

const products: Product[] = [
  {
    id: "prod-1",
    name: "Item",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 1_000,
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

function sale(partial: Partial<Sale> & Pick<Sale, "status" | "totalUgx">): Sale {
  return {
    id: partial.id ?? crypto.randomUUID(),
    createdAt: partial.createdAt ?? `${DAY}T10:00:00.000Z`,
    updatedAt: partial.updatedAt ?? `${DAY}T10:00:00.000Z`,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    estimatedProfitUgx: partial.totalUgx - 1_000,
    lines: [
      {
        id: crypto.randomUUID(),
        productId: "prod-1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: partial.totalUgx,
        unitCostUgx: 1_000,
        estimatedProfitUgx: partial.totalUgx - 1_000,
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

function returnRec(
  saleId: string | null,
  refundAmountUgx: number,
  createdAt = `${DAY}T12:00:00.000Z`,
): ReturnRecord {
  return {
    id: crypto.randomUUID(),
    saleId,
    productId: "prod-1",
    productName: "Item",
    quantity: 1,
    refundAmountUgx,
    reason: "damaged",
    actorUserId: "u1",
    createdAt,
  };
}

function adjustedAfterReturn(base: Sale, refundUgx: number): Sale {
  return { ...base, ...reduceSaleTotalsByAmount(base, refundUgx) };
}

function expectedCash(sales: Sale[], returns: ReturnRecord[], debtPayments: DebtPayment[] = []) {
  return getDrawerCashForDayInput({
    sales,
    returns,
    products,
    debtPayments,
    cashExpenses: [],
    day: DAY,
  }).expectedDrawerCashUgx;
}

describe("linked return cash integrity — Option A", () => {
  it("1: cash sale 60,000 with return 5,000 → expected cash 55,000", () => {
    const base = sale({ status: "completed", totalUgx: 60_000, cashPaidUgx: 60_000, debtUgx: 0 });
    const adjusted = adjustedAfterReturn(base, 5_000);
    const returns = [returnRec(base.id, 5_000)];

    expect(expectedCash([adjusted], returns)).toBe(55_000);
  });

  it("2: cash sale 60,000 with return 20,000 → expected cash 40,000", () => {
    const base = sale({ status: "completed", totalUgx: 60_000, cashPaidUgx: 60_000, debtUgx: 0 });
    const adjusted = adjustedAfterReturn(base, 20_000);
    const returns = [returnRec(base.id, 20_000)];

    expect(expectedCash([adjusted], returns)).toBe(40_000);
  });

  it("3: partial debt sale cash 30,000 + debt 20,000, return 10,000", () => {
    const base = sale({
      status: "completed",
      totalUgx: 50_000,
      cashPaidUgx: 30_000,
      debtUgx: 20_000,
    });
    const adjusted = adjustedAfterReturn(base, 10_000);
    const returns = [returnRec(base.id, 10_000)];

    expect(adjusted.cashPaidUgx).toBe(20_000);
    expect(expectedCash([adjusted], returns)).toBe(20_000);
  });

  it("4: multiple linked returns same day", () => {
    const base = sale({ status: "completed", totalUgx: 60_000, cashPaidUgx: 60_000, debtUgx: 0 });
    let current = base;
    const returns: ReturnRecord[] = [];
    for (const amt of [5_000, 10_000]) {
      current = adjustedAfterReturn(current, amt);
      returns.push(returnRec(base.id, amt));
    }
    expect(current.cashPaidUgx).toBe(45_000);
    expect(expectedCash([current], returns)).toBe(45_000);
  });

  it("5: cross-day linked return subtracts refund on return day only", () => {
    const prior = sale({
      id: "prior-sale",
      status: "completed",
      totalUgx: 40_000,
      cashPaidUgx: 40_000,
      createdAt: `${PRIOR_DAY}T10:00:00.000Z`,
      updatedAt: `${PRIOR_DAY}T10:00:00.000Z`,
    });
    const adjustedPrior = adjustedAfterReturn(prior, 10_000);
    const todaySale = sale({ status: "completed", totalUgx: 60_000, cashPaidUgx: 60_000 });
    const returns = [returnRec(prior.id, 10_000, `${DAY}T12:00:00.000Z`)];

    const drawer = getDrawerCashForDayInput({
      sales: [adjustedPrior, todaySale],
      returns,
      products,
      debtPayments: [],
      cashExpenses: [],
      day: DAY,
    });
    expect(drawer.cashFromSalesUgx).toBe(60_000);
    expect(drawer.expectedDrawerCashUgx).toBe(50_000);
  });

  it("6: damaged return (no restock) does not change expected cash formula", () => {
    const base = sale({ status: "completed", totalUgx: 60_000, cashPaidUgx: 60_000 });
    const adjusted = adjustedAfterReturn(base, 5_000);
    const returns = [returnRec(base.id, 5_000)];
    expect(returns[0]!.reason).toBe("damaged");
    expect(expectedCash([adjusted], returns)).toBe(55_000);
  });

  it("7: unlinked return subtracts full refund (sale header not adjusted)", () => {
    const base = sale({ status: "completed", totalUgx: 60_000, cashPaidUgx: 60_000 });
    const returns = [returnRec(null, 5_000)];
    expect(expectedCash([base], returns)).toBe(55_000);
  });
});

describe("linked return cash integrity — surface consistency", () => {
  it("Close Day drawer, Cash Position, and invariants agree", () => {
    const base = sale({ status: "completed", totalUgx: 60_000, cashPaidUgx: 60_000 });
    const adjusted = adjustedAfterReturn(base, 5_000);
    const returns = [returnRec(base.id, 5_000)];

    const drawer = getDrawerCashForDayInput({
      sales: [adjusted],
      returns,
      products,
      debtPayments: [],
      cashExpenses: [],
      day: DAY,
    });

    const report = buildCashPositionReport({
      lang: "en",
      dayKey: DAY,
      shopName: "Test Shop",
      generalCategoryLabel: "General",
      sales: [adjusted],
      returnRecords: returns,
      products,
      debtPayments: [],
      cashExpenses: [],
      supplierPayments: [],
      staffAccounts: [],
    });

    const invariants = verifyFinancialInvariants({
      sales: [adjusted],
      returns,
      products,
      debtPayments: [],
      cashExpenses: [],
      customers: [],
      day: DAY,
    });

    expect(drawer.expectedDrawerCashUgx).toBe(55_000);
    expect(report.cashPosition.expectedCashUgx).toBe(55_000);
    expect(invariants.ok).toBe(true);
  });

  it("shift expected cash matches net estimated cash after linked return", () => {
    const shift = {
      id: "sh-1",
      actorUserId: "u1",
      role: "cashier" as const,
      startAt: `${DAY}T08:00:00.000Z`,
      endAt: null,
      salesTotalUgx: 60_000,
      debtTotalUgx: 0,
      refundsUgx: 5_000,
      estimatedCashUgx: 55_000,
      debtPaymentsTotalUgx: 0,
      voidsTotalUgx: 0,
      returnsTotalUgx: 5_000,
    };
    expect(shiftExpectedCash(shift)).toBe(55_000);
  });
});
