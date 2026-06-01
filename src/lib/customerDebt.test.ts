import { describe, expect, it } from "vitest";
import type { Customer, DebtPayment, Sale } from "../types";
import {
  applyCustomerDebtDelta,
  creditDebtReductionFromSaleAdjustment,
  reduceSaleTotalsByAmount,
} from "./saleAdjustments";
import {
  computeExpectedCustomerDebt,
  findCustomerDebtMismatches,
  isCustomerDebtBalanced,
} from "./customerDebt";
import { getCompletedFinancials, revenueSalesOnDay } from "./financialMetrics";
import type { Product, SaleLine } from "../types";

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

function payment(amountUgx: number): DebtPayment {
  return {
    id: crypto.randomUUID(),
    customerId: CUSTOMER_ID,
    amountUgx,
    createdAt: `${DAY}T11:00:00.000Z`,
  };
}

/** Simulate store operations on in-memory ledger. */
function simulateCreditLifecycle() {
  let customers: Customer[] = [customer(0)];
  let sales: Sale[] = [];
  let debtPayments: DebtPayment[] = [];

  const creditSale = sale({
    status: "completed",
    totalUgx: 100_000,
    cashPaidUgx: 0,
    debtUgx: 100_000,
    customerId: CUSTOMER_ID,
  });
  sales = [creditSale];
  customers = applyCustomerDebtDelta(customers, CUSTOMER_ID, 100_000);

  debtPayments = [payment(25_000)];
  customers = applyCustomerDebtDelta(customers, CUSTOMER_ID, -25_000);

  const voidAmount = 30_000;
  const debtReduce = creditDebtReductionFromSaleAdjustment(creditSale, voidAmount);
  const totals = reduceSaleTotalsByAmount(creditSale, voidAmount);
  sales = [{ ...creditSale, ...totals }];
  customers = applyCustomerDebtDelta(customers, CUSTOMER_ID, -debtReduce);

  return { customers, sales, debtPayments };
}

describe("computeExpectedCustomerDebt", () => {
  it("credit sale minus payment matches stored balance", () => {
    const creditSale = sale({
      status: "completed",
      totalUgx: 80_000,
      cashPaidUgx: 20_000,
      debtUgx: 60_000,
      customerId: CUSTOMER_ID,
    });
    const payments = [payment(20_000)];
    const c = customer(40_000);
    expect(computeExpectedCustomerDebt(CUSTOMER_ID, [creditSale], payments)).toBe(40_000);
    expect(isCustomerDebtBalanced(c, [creditSale], payments)).toBe(true);
  });

  it("full lifecycle: credit, payment, void stays balanced", () => {
    const { customers, sales, debtPayments } = simulateCreditLifecycle();
    expect(customers[0]!.debtBalanceUgx).toBe(45_000);
    expect(isCustomerDebtBalanced(customers[0]!, sales, debtPayments)).toBe(true);
    expect(findCustomerDebtMismatches(customers, sales, debtPayments)).toHaveLength(0);
  });

  it("detects drift when balance not adjusted after void", () => {
    const creditSale = sale({
      status: "completed",
      totalUgx: 100_000,
      cashPaidUgx: 0,
      debtUgx: 100_000,
      customerId: CUSTOMER_ID,
    });
    const drifted = customer(100_000);
    const debtReduce = creditDebtReductionFromSaleAdjustment(creditSale, 40_000);
    const adjustedSale = { ...creditSale, ...reduceSaleTotalsByAmount(creditSale, 40_000) };
    expect(debtReduce).toBe(40_000);
    const mismatches = findCustomerDebtMismatches([drifted], [adjustedSale], []);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.expected).toBe(60_000);
    expect(mismatches[0]!.stored).toBe(100_000);
  });

  it("pending sales do not affect expected debt", () => {
    const pending = sale({
      status: "pending",
      totalUgx: 500_000,
      cashPaidUgx: 0,
      debtUgx: 500_000,
      customerId: CUSTOMER_ID,
    });
    expect(computeExpectedCustomerDebt(CUSTOMER_ID, [pending], [])).toBe(0);
  });

  it("mixed cash+debt return reduces expected debt correctly", () => {
    let customers: Customer[] = [customer(0)];
    const creditSale = sale({
      status: "completed",
      totalUgx: 100_000,
      cashPaidUgx: 30_000,
      debtUgx: 70_000,
      customerId: CUSTOMER_ID,
    });
    customers = applyCustomerDebtDelta(customers, CUSTOMER_ID, 70_000);
    customers = applyCustomerDebtDelta(customers, CUSTOMER_ID, -15_000);
    const payments = [payment(15_000)];

    const refund = 50_000;
    const debtReduce = creditDebtReductionFromSaleAdjustment(creditSale, refund);
    const adjustedSale = { ...creditSale, ...reduceSaleTotalsByAmount(creditSale, refund) };
    customers = applyCustomerDebtDelta(customers, CUSTOMER_ID, -debtReduce);

    expect(debtReduce).toBe(20_000);
    expect(customers[0]!.debtBalanceUgx).toBe(35_000);
    expect(isCustomerDebtBalanced(customers[0]!, [adjustedSale], payments)).toBe(true);
  });

  it("multiple credit sales aggregate correctly", () => {
    const s1 = sale({
      status: "completed",
      totalUgx: 50_000,
      cashPaidUgx: 0,
      debtUgx: 50_000,
      customerId: CUSTOMER_ID,
    });
    const s2 = sale({
      status: "completed",
      totalUgx: 30_000,
      cashPaidUgx: 0,
      debtUgx: 30_000,
      customerId: CUSTOMER_ID,
    });
    const payments = [payment(10_000)];
    const c = customer(70_000);
    expect(computeExpectedCustomerDebt(CUSTOMER_ID, [s1, s2], payments)).toBe(70_000);
    expect(isCustomerDebtBalanced(c, [s1, s2], payments)).toBe(true);
  });
});

describe("day close uses completed-sale filter", () => {
  it("recordDayClose totals match getCompletedFinancials for the day", () => {
    const completed = sale({ status: "completed", totalUgx: 100_000, cashPaidUgx: 80_000, debtUgx: 20_000 });
    const pending = sale({ status: "pending", totalUgx: 200_000, cashPaidUgx: 0, debtUgx: 0 });
    const cancelled = sale({ status: "cancelled", totalUgx: 50_000 });
    const sales = [completed, pending, cancelled];

    const fin = getCompletedFinancials(sales, [], products, { day: DAY });
    const daySales = revenueSalesOnDay(sales, DAY);

    expect(daySales).toHaveLength(1);
    expect(fin.revenueUgx).toBe(100_000);
    expect(fin.cashCollectedUgx).toBe(80_000);
    expect(fin.debtIssuedUgx).toBe(20_000);
    expect(daySales.reduce((a, s) => a + s.totalUgx, 0)).toBe(fin.revenueUgx);
  });
});
