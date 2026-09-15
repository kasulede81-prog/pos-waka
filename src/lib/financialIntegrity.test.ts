import { describe, expect, it } from "vitest";
import type { Customer, Product, ReturnRecord, Sale, SaleLine } from "../types";
import {
  applyCustomerDebtDelta,
  creditDebtReductionFromSaleAdjustment,
  reduceSaleTotalsByAmount,
} from "./saleAdjustments";
import {
  getCompletedFinancials,
  getCompletedRevenue,
  getCompletedSalesCount,
  isRevenueSale,
  revenueSalesOnDay,
} from "./financialMetrics";
import { isRevenueSale as isRevenueSaleFromStatus } from "./saleStatus";

const DAY = "2026-05-31";
const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function line(partial: Partial<SaleLine> & Pick<SaleLine, "lineTotalUgx">): SaleLine {
  return {
    id: crypto.randomUUID(),
    productId: "prod-1",
    name: "Item",
    quantity: 1,
    unitPriceUgx: partial.lineTotalUgx,
    unitCostUgx: 1000,
    estimatedProfitUgx: partial.lineTotalUgx - 1000,
    inputMode: "quantity",
    updatedAt: `${DAY}T10:00:00.000Z`,
    ...partial,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "status" | "totalUgx">): Sale {
  const lines = partial.lines ?? [line({ lineTotalUgx: partial.totalUgx })];
  return {
    id: crypto.randomUUID(),
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:00:00.000Z`,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    estimatedProfitUgx: partial.totalUgx,
    lines,
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

function customer(debtBalanceUgx: number): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Jane",
    phone: "",
    location: "",
    debtBalanceUgx,
    createdAt: `${DAY}T08:00:00.000Z`,
    version: 1,
  };
}

describe("credit debt adjustment helpers", () => {
  it("mixed cash+debt void reduces debt portion after cash exhausted", () => {
    const s = sale({ status: "completed", totalUgx: 100_000, cashPaidUgx: 40_000, debtUgx: 60_000 });
    expect(creditDebtReductionFromSaleAdjustment(s, 50_000)).toBe(10_000);
    expect(creditDebtReductionFromSaleAdjustment(s, 30_000)).toBe(0);
  });

  it("applyCustomerDebtDelta never goes below zero", () => {
    const customers: Customer[] = [customer(5000)];
    const next = applyCustomerDebtDelta(customers, CUSTOMER_ID, -8000);
    expect(next[0]!.debtBalanceUgx).toBe(0);
  });

  it("reduceSaleTotalsByAmount matches debt reduction for credit void", () => {
    const s = sale({ status: "completed", totalUgx: 80_000, cashPaidUgx: 20_000, debtUgx: 60_000 });
    const amount = 50_000;
    const totals = reduceSaleTotalsByAmount(s, amount);
    const debtReduce = creditDebtReductionFromSaleAdjustment(s, amount);
    expect(totals.debtUgx).toBe(s.debtUgx - debtReduce);
    expect(debtReduce).toBe(30_000);
  });
});

describe("isRevenueSale and completed-only metrics", () => {
  const completed = sale({ status: "completed", totalUgx: 100_000 });
  const pending = sale({ status: "pending", totalUgx: 200_000, cashPaidUgx: 0, debtUgx: 0 });
  const cancelled = sale({ status: "cancelled", totalUgx: 50_000 });

  it("isRevenueSale excludes pending and cancelled", () => {
    expect(isRevenueSale(completed)).toBe(true);
    expect(isRevenueSale(pending)).toBe(false);
    expect(isRevenueSale(cancelled)).toBe(false);
    expect(isRevenueSaleFromStatus(pending)).toBe(false);
  });

  it("hospitality scenario: open 200k + completed 100k => revenue 100k only", () => {
    const openBill = sale({ status: "pending", totalUgx: 200_000, cashPaidUgx: 0, debtUgx: 0 });
    const settled = sale({ status: "completed", totalUgx: 100_000 });
    const revenue = getCompletedRevenue([openBill, settled], [], products, DAY);
    expect(revenue).toBe(100_000);
    expect(getCompletedSalesCount([openBill, settled], DAY)).toBe(1);
    expect(revenueSalesOnDay([openBill, settled], DAY)).toHaveLength(1);
  });

  it("Dashboard and Owner paths agree via getCompletedFinancials", () => {
    const openBill = sale({ status: "pending", totalUgx: 200_000, cashPaidUgx: 0, debtUgx: 0 });
    const settled = sale({ status: "completed", totalUgx: 100_000 });
    const fin = getCompletedFinancials([openBill, settled], [], products, { day: DAY });
    expect(fin.revenueUgx).toBe(100_000);
    expect(fin.transactionCount).toBe(1);
    expect(fin.profitUgx).toBeGreaterThan(0);
  });
});

describe("returns and profit", () => {
  it("return reduces revenue when sale header is adjusted (linked return)", () => {
    const s = sale({ status: "completed", totalUgx: 50_000 });
    const ret: ReturnRecord = {
      id: crypto.randomUUID(),
      saleId: s.id,
      productId: "prod-1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "damaged",
      actorUserId: "u1",
      actorName: "Cashier",
      shiftId: null,
      createdAt: `${DAY}T12:00:00.000Z`,
    };
    const adjusted = { ...s, ...reduceSaleTotalsByAmount(s, 10_000) };
    const before = getCompletedRevenue([s], [], products, DAY);
    const after = getCompletedRevenue([adjusted], [ret], products, DAY);
    expect(after).toBe(before - 10_000);
    expect(after).toBe(40_000);
  });

  it("unlinked return reduces revenue without sale adjustment", () => {
    const s = sale({ status: "completed", totalUgx: 50_000 });
    const ret: ReturnRecord = {
      id: crypto.randomUUID(),
      saleId: null,
      productId: "prod-1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "damaged",
      actorUserId: "u1",
      actorName: "Cashier",
      shiftId: null,
      createdAt: `${DAY}T12:00:00.000Z`,
    };
    const before = getCompletedRevenue([s], [], products, DAY);
    const after = getCompletedRevenue([s], [ret], products, DAY);
    expect(after).toBe(before - 10_000);
  });
});

describe("debt balance invariant simulation", () => {
  it("credit sale minus void debt portion equals customer balance", () => {
    let customers: Customer[] = [customer(0)];
    const creditSale = sale({
      status: "completed",
      totalUgx: 100_000,
      cashPaidUgx: 0,
      debtUgx: 100_000,
      customerId: CUSTOMER_ID,
    });
    customers = applyCustomerDebtDelta(customers, CUSTOMER_ID, creditSale.debtUgx);

    const voidAmount = 25_000;
    const debtReduce = creditDebtReductionFromSaleAdjustment(creditSale, voidAmount);
    customers = applyCustomerDebtDelta(customers, CUSTOMER_ID, -debtReduce);

    expect(customers[0]!.debtBalanceUgx).toBe(75_000);
    expect(reduceSaleTotalsByAmount(creditSale, voidAmount).debtUgx).toBe(75_000);
  });

  it("partial payment then return on credit keeps balance consistent", () => {
    let customers: Customer[] = [customer(0)];
    const creditSale = sale({
      status: "completed",
      totalUgx: 100_000,
      cashPaidUgx: 30_000,
      debtUgx: 70_000,
      customerId: CUSTOMER_ID,
    });
    customers = applyCustomerDebtDelta(customers, CUSTOMER_ID, 70_000);
    customers = applyCustomerDebtDelta(customers, CUSTOMER_ID, -20_000);

    const refund = 40_000;
    const debtReduce = creditDebtReductionFromSaleAdjustment(creditSale, refund);
    customers = applyCustomerDebtDelta(customers, CUSTOMER_ID, -debtReduce);

    expect(debtReduce).toBe(10_000);
    expect(customers[0]!.debtBalanceUgx).toBe(40_000);
  });
});

describe("cart discount revenue invariant", () => {
  it("revenue matches cash plus debt after cart-wide discount", () => {
    const lines = [
      line({ lineTotalUgx: 50_000 }),
      line({ lineTotalUgx: 50_000 }),
    ];
    const discounted = sale({
      status: "completed",
      totalUgx: 90_000,
      cashPaidUgx: 50_000,
      debtUgx: 40_000,
      discountTotalUgx: 10_000,
      lines,
    });
    const fin = getCompletedFinancials([discounted], [], products, { day: DAY });
    expect(fin.revenueUgx).toBe(90_000);
    expect(fin.cashCollectedUgx + fin.debtIssuedUgx).toBe(90_000);
  });
});

describe("pending sale never counts as revenue", () => {
  it("pending sale alone yields zero revenue", () => {
    const pendingOnly = sale({ status: "pending", totalUgx: 999_000, cashPaidUgx: 0, debtUgx: 0 });
    expect(getCompletedRevenue([pendingOnly], [], products, DAY)).toBe(0);
  });
});
