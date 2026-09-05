import { describe, expect, it } from "vitest";
import type { DayCloseSummary, Product, Sale } from "../types";
import { computePaymentMethodMix, computeRangeAnalytics, computeTopCashiers } from "../features/business-analytics/lib/analyticsPageView";
import { buildAnalyticsReportRows } from "./analyticsReportExport";
import { periodSalesBreakdownsUnavailable } from "./closedDayAuthority";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { buildDailyReportDocument, buildDailyReportPdfBlob } from "./dailyReportPdf";
import { resolveDateFilterBounds } from "./dateFilters";
import { t } from "./i18n";
import { localGetRangeSummary } from "./localReporting";
import type { ShopReportBundle } from "../hooks/useShopReporting";
import { REPORTS_DATA_COMPLETE_FLAGS } from "./reportsDataCompleteness";

const DAY_A = "2026-08-12";
const DAY_B = "2026-08-13";

const product: Product = {
  id: "p1",
  name: "Item",
  sellingPricePerUnitUgx: 500_000,
  costPricePerUnitUgx: 100_000,
  stockOnHand: 50,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: `${DAY_A}T09:00:00.000Z`,
  version: 1,
};

function sale(
  id: string,
  totalUgx: number,
  createdAt: string,
  extras: Partial<Sale> = {},
): Sale {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: extras.cashPaidUgx ?? totalUgx,
    debtUgx: extras.debtUgx ?? 0,
    paymentMethod: extras.paymentMethod ?? "cash",
    estimatedProfitUgx: totalUgx - 100_000,
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: totalUgx,
        unitCostUgx: 100_000,
        lineTotalUgx: totalUgx,
        estimatedProfitUgx: totalUgx - 100_000,
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

function closeFor(params: {
  id: string;
  dateKey: string;
  salesUgx: number;
  expectedCashUgx: number;
  countedCashUgx: number;
  profitUgx: number;
  txn: number;
  createdAt: string;
  cashFromSalesUgx?: number;
}): DayCloseSummary {
  const differenceUgx = params.countedCashUgx - params.expectedCashUgx;
  const cashFromSalesUgx = params.cashFromSalesUgx ?? params.salesUgx;
  const row = {
    id: params.id,
    dateKey: params.dateKey,
    expectedCashUgx: params.expectedCashUgx,
    countedCashUgx: params.countedCashUgx,
    differenceUgx,
    totalSalesUgx: params.salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: params.profitUgx,
    openingFloatUgx: 0,
    createdAt: params.createdAt,
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
        cashFromSalesUgx,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 0,
        openingFloatUgx: 0,
        cashSalesUgx: cashFromSalesUgx,
        supplierPaymentsUgx: 0,
        adjustmentInflowsUgx: 0,
        adjustmentOutflowsUgx: 0,
        cashRefundsUgx: 0,
      },
      transactionCount: params.txn,
    }),
    supersededAt: null,
    pendingSync: false,
    updatedAt: params.createdAt,
  };
}

function bundleFromRange(range: ReturnType<typeof localGetRangeSummary>): ShopReportBundle {
  const summary = range.summary;
  return {
    source: "local",
    authority: range.authority,
    closedDayBreakdownUnavailable: range.closedDayBreakdownUnavailable,
    revenue: summary.totalRevenueUgx,
    cash: summary.cashCollectedUgx,
    profit: range.profitUgx,
    debt: "debtIssuedUgx" in summary ? summary.debtIssuedUgx : 0,
    count: summary.transactionCount,
    discountsUgx: "discountsUgx" in summary ? summary.discountsUgx : 0,
    taxesUgx: 0,
    debtOutstanding: range.customers.totalDebtOutstandingUgx,
    topProducts: range.topProducts,
    slowProducts: range.slowProducts,
    marginLeaders: range.topProducts.filter((p) => p.profitUgx > 0).slice(0, 8),
    dailyTrend: [],
    stockValueAtCost: range.inventory.stockValueAtCostUgx,
    supplierDebtTotal: range.supplierDebtTotal,
    ...REPORTS_DATA_COMPLETE_FLAGS,
  };
}

const closeA = closeFor({
  id: "close-a",
  dateKey: DAY_A,
  salesUgx: 500_000,
  expectedCashUgx: 500_000,
  countedCashUgx: 490_000,
  profitUgx: 400_000,
  txn: 1,
  createdAt: `${DAY_A}T18:00:00.000Z`,
});

const frozenSale = sale("s-a", 500_000, `${DAY_A}T10:00:00.000Z`, {
  soldByUserId: "cashier-a",
  discountTotalUgx: 10_000,
});
const lateSale = sale("s-late", 30_000, `${DAY_A}T16:00:00.000Z`, {
  soldByUserId: "cashier-b",
  discountTotalUgx: 5_000,
  paymentMethod: "mobile_money",
});

function dayARange(sales: Sale[], closes: DayCloseSummary[] = [closeA]) {
  return localGetRangeSummary(sales, [product], [], [], [], { kind: "day", dateKey: DAY_A }, [], closes);
}

function dayAAnalytics(sales: Sale[], closes: DayCloseSummary[] = [closeA]) {
  return computeRangeAnalytics(
    sales,
    [product],
    [],
    [],
    [],
    { kind: "day", dateKey: DAY_A },
    [],
    false,
    closes,
  );
}

describe("RPT-P2-01 closed-day report breakdowns must not mix live data", () => {
  it("TEST 1 — closed day headline stays 500,000 and breakdowns ignore the 30,000 live sale", () => {
    const sales = [frozenSale, lateSale];
    const range = dayARange(sales);
    expect(range.summary.totalRevenueUgx).toBe(500_000);
    expect(range.summary.transactionCount).toBe(1);
    expect(range.profitUgx).toBe(400_000);
    expect(range.authority).toBe("closed_snapshot");
    expect(range.closedDayBreakdownUnavailable).toBe(true);
    expect(periodSalesBreakdownsUnavailable(range.authority)).toBe(true);
    expect(range.topProducts).toEqual([]);
    expect(range.slowProducts).toEqual([]);
    expect(range.topProducts.reduce((a, p) => a + p.revenueUgx, 0)).not.toBe(530_000);
  });

  it("TEST 2 — payment mix does not include the post-close sale", () => {
    const sales = [frozenSale, lateSale];
    const bounds = resolveDateFilterBounds({ kind: "day", dateKey: DAY_A });
    const liveMix = computePaymentMethodMix(sales, bounds);
    expect(liveMix.reduce((a, s) => a + s.amountUgx, 0)).toBe(530_000);

    const analytics = dayAAnalytics(sales);
    expect(analytics.closedDayBreakdownUnavailable).toBe(true);
    expect(analytics.paymentMix).toEqual([]);
    expect(analytics.paymentMix.reduce((a, s) => a + s.amountUgx, 0)).not.toBe(530_000);
  });

  it("TEST 3 — post-close sale does not change closed-day top products", () => {
    const open = dayARange([frozenSale], []);
    expect(open.closedDayBreakdownUnavailable).toBe(false);
    expect(open.topProducts[0]?.revenueUgx).toBe(500_000);

    const closed = dayARange([frozenSale, lateSale]);
    expect(closed.closedDayBreakdownUnavailable).toBe(true);
    expect(closed.topProducts).toEqual([]);
    expect(closed.topProducts.some((p) => p.revenueUgx === 530_000)).toBe(false);
  });

  it("TEST 4 — post-close sale does not alter closed-day cashier totals", () => {
    const sales = [frozenSale, lateSale];
    const bounds = resolveDateFilterBounds({ kind: "day", dateKey: DAY_A });
    const liveCashiers = computeTopCashiers(sales, bounds, { lang: "en", nameByUserId: new Map(), shopDisplayName: "Shop" });
    expect(liveCashiers.map((row) => row.id).sort()).toEqual(["cashier-a", "cashier-b"]);

    const analytics = dayAAnalytics(sales);
    expect(analytics.closedDayBreakdownUnavailable).toBe(true);
  });

  it("TEST 5 — post-close sale does not alter closed-day discount totals", () => {
    const live = dayARange([frozenSale, lateSale], []);
    expect(live.summary).toMatchObject({ discountsUgx: 15_000 });

    const closed = dayARange([frozenSale, lateSale]);
    expect(closed.closedDayBreakdownUnavailable).toBe(true);
    expect("discountsUgx" in closed.summary && closed.summary.discountsUgx).toBe(0);
    expect(bundleFromRange(closed).discountsUgx).toBe(0);
  });

  it("TEST 6 — open day breakdowns stay available and include live sales", () => {
    const openSale = sale("s-open", 80_000, `${DAY_B}T10:00:00.000Z`, {
      soldByUserId: "cashier-a",
      discountTotalUgx: 2_000,
    });
    const range = localGetRangeSummary(
      [openSale],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_B },
      [],
      [closeA],
    );
    expect(range.authority).toBe("live");
    expect(range.closedDayBreakdownUnavailable).toBe(false);
    expect(range.summary.totalRevenueUgx).toBe(80_000);
    expect(range.topProducts[0]?.revenueUgx).toBe(80_000);
    expect("discountsUgx" in range.summary && range.summary.discountsUgx).toBe(2_000);

    const analytics = computeRangeAnalytics(
      [openSale],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_B },
      [],
      false,
      [closeA],
    );
    expect(analytics.closedDayBreakdownUnavailable).toBe(false);
    expect(analytics.paymentMix.reduce((a, s) => a + s.amountUgx, 0)).toBe(80_000);
    expect(
      computeTopCashiers([openSale], analytics.bounds, { lang: "en", nameByUserId: new Map(), shopDisplayName: "Shop" }),
    ).toHaveLength(1);
  });

  it("TEST 7 — mixed closed + open range does not present a complete live Day 1 breakdown", () => {
    const dayBSale = sale("s-b", 80_000, `${DAY_B}T10:00:00.000Z`);
    const sales = [frozenSale, lateSale, dayBSale];
    const range = localGetRangeSummary(
      sales,
      [product],
      [],
      [],
      [],
      { kind: "range", fromKey: DAY_A, toKey: DAY_B },
      [],
      [closeA],
    );
    expect(range.authority).toBe("mixed");
    expect(range.summary.totalRevenueUgx).toBe(580_000);
    expect(range.closedDayBreakdownUnavailable).toBe(true);
    expect(range.topProducts).toEqual([]);

    const analytics = computeRangeAnalytics(
      sales,
      [product],
      [],
      [],
      [],
      { kind: "range", fromKey: DAY_A, toKey: DAY_B },
      [],
      false,
      [closeA],
    );
    expect(analytics.closedDayBreakdownUnavailable).toBe(true);
    expect(analytics.paymentMix).toEqual([]);
    expect(analytics.paymentMix.reduce((a, s) => a + s.amountUgx, 0)).not.toBe(610_000);
  });

  it("TEST 8 — closed day without post-close activity keeps frozen headlines", () => {
    const range = dayARange([frozenSale]);
    expect(range.summary.totalRevenueUgx).toBe(500_000);
    expect(range.summary.transactionCount).toBe(1);
    expect(range.profitUgx).toBe(400_000);
    expect(range.authority).toBe("closed_snapshot");
    expect(range.closedDayBreakdownUnavailable).toBe(true);
    expect(range.topProducts).toEqual([]);
    expect(range.dailyTrend[0]?.revenueUgx).toBe(500_000);
  });

  it("TEST 9 — closed-day CSV and PDF do not export live post-close breakdown values", async () => {
    const sales = [frozenSale, lateSale];
    const range = dayARange(sales);
    const csv = buildAnalyticsReportRows({
      lang: "en",
      title: "Reports",
      periodLabel: DAY_A,
      report: bundleFromRange(range),
      expensesUgx: 0,
      purchasesInPeriodUgx: 0,
      canProfit: true,
    });
    const csvText = csv.flat().join(" ");
    expect(csv.some((row) => row[0] === t("en", "receiptsRangeRevenue") && row[1] === 500_000)).toBe(true);
    expect(csvText).toContain(t("en", "reportsClosedBreakdownUnavailable"));
    expect(csvText).not.toContain("530000");
    expect(csv.some((row) => row[0] === "Item" && row[1] === 530_000)).toBe(false);

    const model = buildDailyReportDocument({
      lang: "en",
      dateKey: DAY_A,
      shopName: "Waka",
      sales,
      products: [product],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      topProducts: [{ productId: "p1", name: "Item", quantity: 2, revenueUgx: 530_000, profitUgx: 330_000 }],
      dayCloses: [closeA],
    });
    expect(model.sections.some((s) => s.live)).toBe(false);
    expect(model.sections.flatMap((s) => s.rows).some((r) => r.value.includes("530,000"))).toBe(false);
    expect(model.sections.flatMap((s) => s.rows).some((r) => r.label === t("en", "reportsClosedBreakdownUnavailable"))).toBe(
      true,
    );

    const pdf = await buildDailyReportPdfBlob({
      lang: "en",
      dateKey: DAY_A,
      shopName: "Waka",
      sales,
      products: [product],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      topProducts: [{ productId: "p1", name: "Item", quantity: 2, revenueUgx: 530_000, profitUgx: 330_000 }],
      dayCloses: [closeA],
    }).text();
    expect(pdf).toContain("UGX 500,000");
    expect(pdf).not.toContain("UGX 530,000");
    expect(pdf).toContain("Unavailable for closed day");
  });
});
