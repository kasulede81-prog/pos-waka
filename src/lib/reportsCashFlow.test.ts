import { describe, expect, it } from "vitest";
import type {
  CashDrawerAdjustment,
  CashExpense,
  DayCloseSummary,
  DebtPayment,
  Product,
  ReturnRecord,
  Sale,
  SupplierPayment,
} from "../types";
import { buildAnalyticsReportRows } from "./analyticsReportExport";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { t } from "./i18n";
import { computeReportsPeriodCashFlow, periodCashFlowFromDrawer } from "./reportsCashFlow";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import type { ShopReportBundle } from "../hooks/useShopReporting";

const DAY_A = "2026-08-12";
const DAY_B = "2026-08-13";

const product: Product = {
  id: "p1",
  name: "Item",
  sellingPricePerUnitUgx: 100_000,
  costPricePerUnitUgx: 40_000,
  stockOnHand: 50,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: `${DAY_A}T09:00:00.000Z`,
  version: 1,
};

function sale(id: string, totalUgx: number, createdAt: string, extras: Partial<Sale> = {}): Sale {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: extras.cashPaidUgx ?? totalUgx,
    debtUgx: extras.debtUgx ?? 0,
    paymentMethod: extras.paymentMethod ?? "cash",
    estimatedProfitUgx: totalUgx - 40_000,
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: totalUgx,
        unitCostUgx: 40_000,
        lineTotalUgx: totalUgx,
        estimatedProfitUgx: totalUgx - 40_000,
        inputMode: "quantity",
        voided: false,
        updatedAt: createdAt,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    status: "completed",
    ...extras,
  };
}

function expense(amountUgx: number, paidOn: string, extras: Partial<CashExpense> = {}): CashExpense {
  return {
    id: `exp-${amountUgx}-${paidOn}`,
    category: "transport",
    amountUgx,
    description: "Expense",
    paidOn,
    createdAt: `${paidOn}T12:00:00.000Z`,
    createdByUserId: "owner",
    approvalStatus: "approved",
    pendingSync: false,
    deletedAt: null,
    ...extras,
  };
}

function debtPay(amountUgx: number, createdAt: string): DebtPayment {
  return {
    id: `dp-${amountUgx}`,
    customerId: "c1",
    amountUgx,
    createdAt,
  };
}

function supplierPay(amountUgx: number, createdAt: string): SupplierPayment {
  return {
    id: `sp-${amountUgx}`,
    supplierId: "sup-1",
    amountUgx,
    createdAt,
    pendingSync: false,
  };
}

function adjustment(
  type: CashDrawerAdjustment["type"],
  amountUgx: number,
  occurredAt: string,
): CashDrawerAdjustment {
  return {
    id: `adj-${type}-${amountUgx}`,
    type,
    amountUgx,
    note: type,
    actorUserId: "owner",
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    pendingSync: false,
    deletedAt: null,
  };
}

function refund(amountUgx: number, createdAt: string, refundCashUgx: number): ReturnRecord {
  return {
    id: `ret-${amountUgx}`,
    saleId: null,
    productId: "p1",
    productName: "Item",
    quantity: 1,
    refundAmountUgx: amountUgx,
    refundCashUgx,
    reason: "other",
    actorUserId: "owner",
    actorName: "Owner",
    shiftId: null,
    createdAt,
  };
}

function closeWithDrawer(params: {
  dateKey: string;
  salesUgx: number;
  cashFromSalesUgx: number;
  debtCollectedUgx?: number;
  expenseUgx?: number;
  supplierPaymentsUgx?: number;
  adjustmentInflowsUgx?: number;
  adjustmentOutflowsUgx?: number;
  cashRefundsUgx?: number;
  openingFloatUgx?: number;
}): DayCloseSummary {
  const createdAt = `${params.dateKey}T18:00:00.000Z`;
  const row = {
    id: `close-${params.dateKey}`,
    dateKey: params.dateKey,
    expectedCashUgx: params.cashFromSalesUgx,
    countedCashUgx: params.cashFromSalesUgx,
    differenceUgx: 0,
    totalSalesUgx: params.salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: 0,
    openingFloatUgx: params.openingFloatUgx ?? 0,
    createdAt,
    closedByUserId: "owner",
    closedByLabel: "Owner",
  };
  return {
    ...row,
    documentSnapshot: buildDayCloseSnapshot({
      closedByUserId: "owner",
      closedByLabel: "Owner",
      row,
      drawer: {
        cashFromSalesUgx: params.cashFromSalesUgx,
        debtCollectedUgx: params.debtCollectedUgx ?? 0,
        refundsUgx: 0,
        expenseUgx: params.expenseUgx ?? 0,
        openingFloatUgx: params.openingFloatUgx ?? 0,
        cashSalesUgx: params.cashFromSalesUgx,
        supplierPaymentsUgx: params.supplierPaymentsUgx ?? 0,
        adjustmentInflowsUgx: params.adjustmentInflowsUgx ?? 0,
        adjustmentOutflowsUgx: params.adjustmentOutflowsUgx ?? 0,
        cashRefundsUgx: params.cashRefundsUgx ?? 0,
      },
      transactionCount: 1,
    }),
    supersededAt: null,
    pendingSync: false,
    updatedAt: createdAt,
  };
}

function flow(input: {
  sales?: Sale[];
  returns?: ReturnRecord[];
  debtPayments?: DebtPayment[];
  cashExpenses?: CashExpense[];
  supplierPayments?: SupplierPayment[];
  cashDrawerAdjustments?: CashDrawerAdjustment[];
  dayCloses?: DayCloseSummary[];
  dateKey?: string;
  fromKey?: string;
  toKey?: string;
}) {
  const fromKey = input.fromKey ?? input.dateKey ?? DAY_A;
  const toKey = input.toKey ?? input.dateKey ?? DAY_A;
  return computeReportsPeriodCashFlow({
    sales: input.sales ?? [],
    returns: input.returns ?? [],
    products: [product],
    debtPayments: input.debtPayments ?? [],
    cashExpenses: input.cashExpenses ?? [],
    supplierPayments: input.supplierPayments ?? [],
    cashDrawerAdjustments: input.cashDrawerAdjustments ?? [],
    dayCloses: input.dayCloses,
    bounds: { fromKey, toKey, isSingleDay: fromKey === toKey },
  });
}

describe("RPT-P2-02 Reports Cash Flow is physical cash movement", () => {
  it("TEST 1 — pure cash sale is +100,000 inflow", () => {
    const result = flow({
      sales: [sale("s-cash", 100_000, `${DAY_A}T10:00:00.000Z`)],
      dateKey: DAY_A,
    });
    expect(result.unavailable).toBe(false);
    expect(result.cashInUgx).toBe(100_000);
    expect(result.cashOutUgx).toBe(0);
    expect(result.netUgx).toBe(100_000);
  });

  it("TEST 2 — pure MoMo sale is 0 physical inflow", () => {
    const result = flow({
      sales: [
        sale("s-momo", 100_000, `${DAY_A}T10:00:00.000Z`, {
          paymentMethod: "mobile_money",
          cashPaidUgx: 100_000,
        }),
      ],
      dateKey: DAY_A,
    });
    expect(result.cashInUgx).toBe(0);
    expect(result.netUgx).toBe(0);
  });

  it("TEST 3 — mixed tender inflow is physical cash 30,000 only", () => {
    const result = flow({
      sales: [
        sale("s-mix", 100_000, `${DAY_A}T10:00:00.000Z`, {
          paymentMethod: "mixed",
          cashPaidUgx: 50_000,
          debtUgx: 50_000,
          tenderCashUgx: 30_000,
        }),
      ],
      dateKey: DAY_A,
    });
    expect(result.cashInUgx).toBe(30_000);
    expect(result.netUgx).toBe(30_000);
  });

  it("TEST 4 — debt collection uses existing amount-as-cash semantics", () => {
    const result = flow({
      debtPayments: [debtPay(25_000, `${DAY_A}T14:00:00.000Z`)],
      dateKey: DAY_A,
    });
    expect(result.cashInUgx).toBe(25_000);
    expect(result.netUgx).toBe(25_000);
  });

  it("TEST 5 — cash-in adjustment is +20,000", () => {
    const result = flow({
      cashDrawerAdjustments: [adjustment("cash_added", 20_000, `${DAY_A}T11:00:00.000Z`)],
      dateKey: DAY_A,
    });
    expect(result.cashInUgx).toBe(20_000);
    expect(result.netUgx).toBe(20_000);
  });

  it("TEST 6 — cash-out adjustment is -15,000", () => {
    const result = flow({
      cashDrawerAdjustments: [adjustment("cash_removed", 15_000, `${DAY_A}T11:00:00.000Z`)],
      dateKey: DAY_A,
    });
    expect(result.cashOutUgx).toBe(15_000);
    expect(result.netUgx).toBe(-15_000);
  });

  it("TEST 7 — approved expense is -10,000", () => {
    const result = flow({
      cashExpenses: [expense(10_000, DAY_A)],
      dateKey: DAY_A,
    });
    expect(result.cashOutUgx).toBe(10_000);
    expect(result.netUgx).toBe(-10_000);
  });

  it("TEST 8 — supplier payment 30,000 is outflow; purchase invoice 100,000 is not", () => {
    const result = flow({
      supplierPayments: [supplierPay(30_000, `${DAY_A}T15:00:00.000Z`)],
      dateKey: DAY_A,
    });
    expect(result.cashOutUgx).toBe(30_000);
    expect(result.cashOutUgx).not.toBe(100_000);
    expect(result.netUgx).toBe(-30_000);
  });

  it("TEST 9 — external physical refund is -20,000", () => {
    const result = flow({
      returns: [refund(20_000, `${DAY_A}T16:00:00.000Z`, 20_000)],
      dateKey: DAY_A,
    });
    expect(result.cashOutUgx).toBe(20_000);
    expect(result.netUgx).toBe(-20_000);
  });

  it("TEST 10 — open-day range sums each day's physical movement", () => {
    const result = flow({
      sales: [
        sale("s-a", 100_000, `${DAY_A}T10:00:00.000Z`),
        sale("s-b", 50_000, `${DAY_B}T10:00:00.000Z`),
      ],
      cashExpenses: [expense(10_000, DAY_B)],
      fromKey: DAY_A,
      toKey: DAY_B,
    });
    expect(result.unavailable).toBe(false);
    expect(result.cashInUgx).toBe(150_000);
    expect(result.cashOutUgx).toBe(10_000);
    expect(result.netUgx).toBe(140_000);
  });

  it("TEST 11 — closed day uses frozen snapshot, not post-close live cash", () => {
    const close = closeWithDrawer({
      dateKey: DAY_A,
      salesUgx: 100_000,
      cashFromSalesUgx: 100_000,
      openingFloatUgx: 80_000,
    });
    const liveExtra = sale("s-late", 30_000, `${DAY_A}T19:00:00.000Z`);
    const result = flow({
      sales: [sale("s-a", 100_000, `${DAY_A}T10:00:00.000Z`), liveExtra],
      dayCloses: [close],
      dateKey: DAY_A,
    });
    expect(result.unavailable).toBe(false);
    expect(result.cashInUgx).toBe(100_000);
    expect(result.cashInUgx).not.toBe(130_000);
    expect(result.cashInUgx).not.toBe(180_000);
    expect(result.netUgx).toBe(100_000);
  });

  it("TEST 11b — closed day without reconstructable snapshot is unavailable", () => {
    const bare: DayCloseSummary = {
      id: "close-bare",
      dateKey: DAY_A,
      expectedCashUgx: 100_000,
      countedCashUgx: 100_000,
      differenceUgx: 0,
      totalSalesUgx: 100_000,
      totalDebtUgx: 0,
      profitEstimateUgx: 0,
      openingFloatUgx: 0,
      createdAt: `${DAY_A}T18:00:00.000Z`,
      closedByUserId: "owner",
      closedByLabel: "Owner",
      documentSnapshot: null,
      supersededAt: null,
      pendingSync: false,
      updatedAt: `${DAY_A}T18:00:00.000Z`,
    };
    const result = flow({
      sales: [sale("s-a", 100_000, `${DAY_A}T10:00:00.000Z`)],
      dayCloses: [bare],
      dateKey: DAY_A,
    });
    expect(result.unavailable).toBe(true);
    expect(result.cashInUgx).toBe(0);
  });

  it("TEST 12 — mixed range uses frozen Day 1 + live Day 2, not Day 1 live post-close", () => {
    const close = closeWithDrawer({
      dateKey: DAY_A,
      salesUgx: 100_000,
      cashFromSalesUgx: 100_000,
    });
    const result = flow({
      sales: [
        sale("s-a", 100_000, `${DAY_A}T10:00:00.000Z`),
        sale("s-late", 30_000, `${DAY_A}T19:00:00.000Z`),
        sale("s-b", 50_000, `${DAY_B}T10:00:00.000Z`),
      ],
      dayCloses: [close],
      fromKey: DAY_A,
      toKey: DAY_B,
    });
    expect(result.unavailable).toBe(false);
    expect(result.cashInUgx).toBe(150_000);
    expect(result.cashInUgx).not.toBe(180_000);
  });

  it("TEST 13 — cards share one semantic: net equals cash in minus cash out", () => {
    const sales = [
      sale("s-mix", 100_000, `${DAY_A}T10:00:00.000Z`, {
        paymentMethod: "mixed",
        cashPaidUgx: 50_000,
        debtUgx: 50_000,
        tenderCashUgx: 30_000,
      }),
    ];
    const drawer = getDrawerCashForDayInput({
      sales,
      returns: [],
      products: [product],
      debtPayments: [debtPay(5_000, `${DAY_A}T12:00:00.000Z`)],
      cashExpenses: [expense(10_000, DAY_A)],
      supplierPayments: [supplierPay(8_000, `${DAY_A}T13:00:00.000Z`)],
      cashDrawerAdjustments: [
        adjustment("cash_added", 20_000, `${DAY_A}T11:00:00.000Z`),
        adjustment("opening_float", 80_000, `${DAY_A}T07:00:00.000Z`),
      ],
      day: DAY_A,
    });
    const fromDrawer = periodCashFlowFromDrawer(drawer);
    const cards = flow({
      sales,
      debtPayments: [debtPay(5_000, `${DAY_A}T12:00:00.000Z`)],
      cashExpenses: [expense(10_000, DAY_A)],
      supplierPayments: [supplierPay(8_000, `${DAY_A}T13:00:00.000Z`)],
      cashDrawerAdjustments: [
        adjustment("cash_added", 20_000, `${DAY_A}T11:00:00.000Z`),
        adjustment("opening_float", 80_000, `${DAY_A}T07:00:00.000Z`),
      ],
      dateKey: DAY_A,
    });
    expect(cards.cashInUgx).toBe(fromDrawer.cashInUgx);
    expect(cards.cashOutUgx).toBe(fromDrawer.cashOutUgx);
    expect(cards.netUgx).toBe(fromDrawer.netUgx);
    expect(cards.netUgx).toBe(cards.cashInUgx - cards.cashOutUgx);
    expect(cards.cashInUgx).toBe(55_000);
    expect(cards.cashOutUgx).toBe(18_000);
    expect(cards.cashInUgx).not.toBe(80_000 + 55_000);
  });

  it("TEST 14 — export cash flow matches UI semantic, not purchase invoices", () => {
    const cashFlow = flow({
      sales: [sale("s-cash", 100_000, `${DAY_A}T10:00:00.000Z`)],
      supplierPayments: [supplierPay(30_000, `${DAY_A}T15:00:00.000Z`)],
      dateKey: DAY_A,
    });
    const report: ShopReportBundle = {
      source: "local",
      authority: "live",
      closedDayBreakdownUnavailable: false,
      revenue: 100_000,
      cash: 100_000,
      profit: 60_000,
      debt: 0,
      count: 1,
      discountsUgx: 0,
      taxesUgx: 0,
      debtOutstanding: 0,
      topProducts: [],
      slowProducts: [],
      marginLeaders: [],
      dailyTrend: [],
      stockValueAtCost: 0,
      supplierDebtTotal: 0,
      loading: false,
      dataComplete: true,
      remainderReady: true,
    };
    const rows = buildAnalyticsReportRows({
      lang: "en",
      title: "Reports",
      periodLabel: DAY_A,
      report,
      expensesUgx: 0,
      purchasesInPeriodUgx: 100_000,
      cashFlow,
      canProfit: true,
    });
    expect(rows.some((row) => row[0] === t("en", "eodSummaryCashIn") && row[1] === 100_000)).toBe(true);
    expect(rows.some((row) => row[0] === t("en", "eodSummaryCashOut") && row[1] === 30_000)).toBe(true);
    expect(rows.some((row) => row[0] === t("en", "baNetCashFlow") && row[1] === 70_000)).toBe(true);
    expect(rows.some((row) => row[0] === t("en", "baPurchasesInPeriod") && row[1] === 100_000)).toBe(true);
    expect(rows.some((row) => row[0] === t("en", "eodSummaryCashOut") && row[1] === 100_000)).toBe(false);
  });
});
