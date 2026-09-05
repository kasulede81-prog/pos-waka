import { describe, expect, it } from "vitest";
import type { DayCloseSummary, Product, ReturnRecord, Sale, SaleLine } from "../types";
import { buildAnalyticsReportRows } from "./analyticsReportExport";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { resolveDateFilterBounds } from "./dateFilters";
import { t } from "./i18n";
import { localGetRangeSummary } from "./localReporting";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import {
  applyReportsCompletenessToBundle,
  canExportReportsData,
  REPORTS_DATA_COMPLETE_FLAGS,
  resolveReportsDataCompleteness,
  resolveReportsFinancialReadiness,
  runReportsExportIfComplete,
  sumFrozenPeriodHeadlines,
  type ReportsFinancialBundleCore,
} from "./reportsDataCompleteness";

const DAY1 = "2026-08-12";
const DAY2 = "2026-08-13";
const ARCHIVE_DAY = "2026-06-01";

const product: Product = {
  id: "prod-1",
  name: "Widget",
  sellingPricePerUnitUgx: 10_000,
  costPricePerUnitUgx: 6_000,
  stockOnHand: 50,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: `${DAY1}T09:00:00.000Z`,
  version: 1,
};

function line(total: number, unitCost = 6_000): SaleLine {
  return {
    productId: "prod-1",
    name: "Widget",
    quantity: 1,
    unitPriceUgx: total,
    unitCostUgx: unitCost,
    cogsUgx: unitCost,
    netRevenueUgx: total,
    grossProfitUgx: total - unitCost,
    estimatedProfitUgx: total - unitCost,
    inputMode: "quantity",
    voided: false,
    lineTotalUgx: total,
  };
}

function sale(id: string, totalUgx: number, day: string): Sale {
  const at = `${day}T10:00:00.000Z`;
  return {
    id,
    createdAt: at,
    updatedAt: at,
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: totalUgx,
    debtUgx: 0,
    paymentMethod: "cash",
    estimatedProfitUgx: totalUgx - 6_000,
    lines: [line(totalUgx)],
    pendingSync: false,
    lastSyncError: null,
    status: "completed",
  };
}

function linkedReturn(id: string, saleId: string, day: string, refundAmountUgx: number): ReturnRecord {
  return {
    id,
    saleId,
    productId: "prod-1",
    productName: "Widget",
    quantity: 1,
    reason: "wrong_item",
    actorUserId: "owner",
    actorName: "Owner",
    shiftId: null,
    createdAt: `${day}T14:00:00.000Z`,
    refundAmountUgx,
    cogsUgx: Math.round((6_000 * refundAmountUgx) / 10_000),
  };
}

function closeFor(params: {
  dateKey: string;
  salesUgx: number;
  profitUgx: number;
  txn: number;
}): DayCloseSummary {
  const createdAt = `${params.dateKey}T18:00:00.000Z`;
  const row = {
    id: `close-${params.dateKey}`,
    dateKey: params.dateKey,
    expectedCashUgx: params.salesUgx,
    countedCashUgx: params.salesUgx,
    differenceUgx: 0,
    totalSalesUgx: params.salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: params.profitUgx,
    openingFloatUgx: 0,
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
        cashFromSalesUgx: params.salesUgx,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 0,
        openingFloatUgx: 0,
        cashSalesUgx: params.salesUgx,
        supplierPaymentsUgx: 0,
        adjustmentInflowsUgx: 0,
        adjustmentOutflowsUgx: 0,
        cashRefundsUgx: 0,
      },
      transactionCount: params.txn,
    }),
    supersededAt: null,
    pendingSync: false,
    updatedAt: createdAt,
  };
}

function coreFromRange(range: ReturnType<typeof localGetRangeSummary>): ReportsFinancialBundleCore {
  const summary = range.summary;
  return {
    authority: range.authority,
    closedDayBreakdownUnavailable: range.closedDayBreakdownUnavailable,
    revenue: summary.totalRevenueUgx,
    cash: (summary as { cashCollectedUgx?: number }).cashCollectedUgx ?? summary.totalRevenueUgx,
    profit: range.profitUgx,
    debt: "debtIssuedUgx" in summary ? summary.debtIssuedUgx : 0,
    count: summary.transactionCount,
    discountsUgx: "discountsUgx" in summary ? summary.discountsUgx : 0,
    taxesUgx: 0,
    topProducts: range.topProducts,
    slowProducts: range.slowProducts,
    marginLeaders: range.topProducts.filter((p) => p.profitUgx > 0).slice(0, 8),
    dailyTrend: [],
  };
}

function exportRows(bundle: ReportsFinancialBundleCore & { dataComplete: boolean }) {
  return buildAnalyticsReportRows({
    lang: "en",
    title: "Reports",
    periodLabel: DAY1,
    report: {
      source: "local",
      authority: bundle.authority,
      closedDayBreakdownUnavailable: bundle.closedDayBreakdownUnavailable,
      revenue: bundle.revenue,
      cash: bundle.cash,
      profit: bundle.profit,
      debt: bundle.debt,
      count: bundle.count,
      discountsUgx: bundle.discountsUgx,
      taxesUgx: bundle.taxesUgx,
      debtOutstanding: 0,
      topProducts: [],
      slowProducts: [],
      marginLeaders: [],
      dailyTrend: [],
      stockValueAtCost: 0,
      supplierDebtTotal: 0,
      loading: false,
      dataComplete: bundle.dataComplete,
      remainderReady: bundle.dataComplete,
    },
    expensesUgx: 0,
    purchasesInPeriodUgx: 0,
    canProfit: true,
  });
}

const fiveHundred = Array.from({ length: 500 }, (_, i) => sale(`s-${i}`, 10_000, DAY1));
const firstHundred = fiveHundred.slice(0, 100);

describe("RPT-P2-04 reports data completeness", () => {
  it("TEST 1 — initial partial load does not present final revenue, count, or profit", () => {
    const completeness = resolveReportsDataCompleteness({
      hydrationStage: "interactive",
      salesHistoryHydration: { active: true, loaded: 100, total: 500 },
    });
    expect(completeness.dataComplete).toBe(false);
    expect(completeness.salesHydrating).toBe(true);

    const livePartial = localGetRangeSummary(
      firstHundred,
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY1 },
    );
    expect(livePartial.summary.totalRevenueUgx).toBe(1_000_000);
    expect(livePartial.summary.transactionCount).toBe(100);

    const readiness = resolveReportsFinancialReadiness({
      hydrationStage: "interactive",
      salesHistoryHydration: { active: true, loaded: 100, total: 500 },
      authority: "live",
    });
    const presented = applyReportsCompletenessToBundle(coreFromRange(livePartial), readiness, null);
    expect(presented.loading).toBe(true);
    expect(presented.dataComplete).toBe(false);
    expect(presented.revenue).toBe(0);
    expect(presented.count).toBe(0);
    expect(presented.profit).toBe(0);
    expect(presented.topProducts).toEqual([]);
    expect(canExportReportsData(presented)).toBe(false);
  });

  it("TEST 2 — after all required sales load, KPIs include every row and loading clears", () => {
    const complete = localGetRangeSummary(fiveHundred, [product], [], [], [], { kind: "day", dateKey: DAY1 });
    const readiness = resolveReportsFinancialReadiness({
      hydrationStage: "complete",
      salesHistoryHydration: null,
      authority: "live",
    });
    const presented = applyReportsCompletenessToBundle(coreFromRange(complete), readiness, null);
    expect(presented.loading).toBe(false);
    expect(presented.dataComplete).toBe(true);
    expect(presented.revenue).toBe(5_000_000);
    expect(presented.count).toBe(500);
    expect(presented.profit).toBe(complete.profitUgx);
    expect(presented.profit).toBe(2_000_000);
  });

  it("TEST 3 — export during loading is blocked and produces no partial file", () => {
    const partial = localGetRangeSummary(firstHundred, [product], [], [], [], { kind: "day", dateKey: DAY1 });
    const readiness = resolveReportsFinancialReadiness({
      hydrationStage: "complete",
      salesHistoryHydration: { active: true, loaded: 100, total: 500 },
      authority: "live",
    });
    const presented = applyReportsCompletenessToBundle(coreFromRange(partial), readiness, null);
    const exported = runReportsExportIfComplete(presented.dataComplete, () => exportRows({ ...presented, dataComplete: true }));
    expect(exported).toBeNull();
    expect(canExportReportsData(presented)).toBe(false);
  });

  it("TEST 4 — export after completion matches on-screen totals", () => {
    const complete = localGetRangeSummary(fiveHundred, [product], [], [], [], { kind: "day", dateKey: DAY1 });
    const readiness = resolveReportsFinancialReadiness({
      hydrationStage: "complete",
      salesHistoryHydration: null,
      authority: "live",
    });
    const presented = applyReportsCompletenessToBundle(coreFromRange(complete), readiness, null);
    const rows = runReportsExportIfComplete(presented.dataComplete, () => exportRows(presented));
    expect(rows).not.toBeNull();
    expect(rows!.some((row) => row[0] === t("en", "receiptsRangeRevenue") && row[1] === presented.revenue)).toBe(true);
    expect(rows!.some((row) => row[0] === t("en", "salesCount") && row[1] === presented.count)).toBe(true);
    expect(rows!.some((row) => row[0] === t("en", "profitStatGrossProfit") && row[1] === presented.profit)).toBe(true);
  });

  it("TEST 5 — range change while loading does not present stale range-A totals as range-B finals", () => {
    const rangeAClose = closeFor({ dateKey: DAY1, salesUgx: 500_000, profitUgx: 200_000, txn: 1 });
    const rangeASale = sale("a1", 10_000, DAY1);
    const rangeBSales = [sale("b1", 80_000, DAY2), sale("b2", 20_000, DAY2)];

    const incomplete = { hydrationStage: "interactive" as const, salesHistoryHydration: { active: true, loaded: 1, total: 3 } };

    const frozenA = applyReportsCompletenessToBundle(
      coreFromRange(localGetRangeSummary([rangeASale], [product], [], [], [], { kind: "day", dateKey: DAY1 }, [], [rangeAClose])),
      resolveReportsFinancialReadiness({ ...incomplete, authority: "closed_snapshot" }),
      sumFrozenPeriodHeadlines([rangeAClose], resolveDateFilterBounds({ kind: "day", dateKey: DAY1 })),
    );
    expect(frozenA.revenue).toBe(500_000);
    expect(frozenA.loading).toBe(false);
    expect(frozenA.dataComplete).toBe(false);

    const liveBPartial = applyReportsCompletenessToBundle(
      coreFromRange(localGetRangeSummary([rangeASale, ...rangeBSales], [product], [], [], [], { kind: "day", dateKey: DAY2 })),
      resolveReportsFinancialReadiness({ ...incomplete, authority: "live" }),
      null,
    );
    expect(liveBPartial.loading).toBe(true);
    expect(liveBPartial.revenue).toBe(0);
    expect(liveBPartial.count).toBe(0);
    expect(liveBPartial.revenue).not.toBe(frozenA.revenue);

    const liveBComplete = applyReportsCompletenessToBundle(
      coreFromRange(localGetRangeSummary(rangeBSales, [product], [], [], [], { kind: "day", dateKey: DAY2 })),
      resolveReportsFinancialReadiness({
        hydrationStage: "complete",
        salesHistoryHydration: null,
        authority: "live",
      }),
      null,
    );
    expect(liveBComplete.loading).toBe(false);
    expect(liveBComplete.revenue).toBe(100_000);
    expect(liveBComplete.count).toBe(2);
  });

  it("TEST 6 — profit is not final until linked-return data required by RPT-P1-02 is loaded", () => {
    const original = sale("s-day1", 10_000, DAY1);
    const linked = linkedReturn("r-day2", original.id, DAY2, 10_000);
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 10_000) };

    const withoutReturn = localGetRangeSummary([original], [product], [], [], [], { kind: "day", dateKey: DAY1 });
    const pendingReturns = applyReportsCompletenessToBundle(
      coreFromRange(withoutReturn),
      resolveReportsFinancialReadiness({
        hydrationStage: "interactive",
        salesHistoryHydration: null,
        authority: "live",
      }),
      null,
    );
    expect(pendingReturns.dataComplete).toBe(false);
    expect(pendingReturns.loading).toBe(true);
    expect(pendingReturns.profit).toBe(0);
    expect(withoutReturn.profitUgx).toBe(4_000);

    const withReturn = localGetRangeSummary([adjusted], [product], [], [linked], [], { kind: "day", dateKey: DAY1 });
    const complete = applyReportsCompletenessToBundle(
      coreFromRange(withReturn),
      resolveReportsFinancialReadiness({
        hydrationStage: "complete",
        salesHistoryHydration: null,
        authority: "live",
      }),
      null,
    );
    expect(complete.dataComplete).toBe(true);
    expect(complete.profit).toBe(0);
    expect(complete.revenue).toBe(0);
  });

  it("TEST 7 — closed-day frozen headline stays authoritative and is not replaced by partial live data", () => {
    const closedSale = sale("closed-1", 10_000, DAY1);
    const unloadedTailWouldHaveBeen = sale("closed-2", 10_000, DAY1);
    const close = closeFor({ dateKey: DAY1, salesUgx: 500_000, profitUgx: 200_000, txn: 50 });
    const livePartial = localGetRangeSummary(
      [closedSale],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY1 },
      [],
      [close],
    );
    expect(livePartial.authority).toBe("closed_snapshot");
    expect(livePartial.summary.totalRevenueUgx).toBe(500_000);

    const inflatedIfOverlayUsedPartialTail = localGetRangeSummary(
      [closedSale, unloadedTailWouldHaveBeen],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY1 },
      [],
      [close],
    );
    expect(inflatedIfOverlayUsedPartialTail.summary.totalRevenueUgx).toBe(500_000);

    const readiness = resolveReportsFinancialReadiness({
      hydrationStage: "complete",
      salesHistoryHydration: { active: true, loaded: 1, total: 50 },
      authority: "closed_snapshot",
    });
    const presented = applyReportsCompletenessToBundle(
      coreFromRange(livePartial),
      readiness,
      sumFrozenPeriodHeadlines([close], resolveDateFilterBounds({ kind: "day", dateKey: DAY1 })),
    );
    expect(presented.loading).toBe(false);
    expect(presented.dataComplete).toBe(false);
    expect(presented.revenue).toBe(500_000);
    expect(presented.profit).toBe(200_000);
    expect(presented.count).toBe(50);
    expect(presented.closedDayBreakdownUnavailable).toBe(true);
    expect(canExportReportsData(presented)).toBe(false);
  });

  it("TEST 8 — open-day reports are unchanged once complete", () => {
    const open = [sale("o1", 30_000, DAY1), sale("o2", 20_000, DAY1)];
    const range = localGetRangeSummary(open, [product], [], [], [], { kind: "day", dateKey: DAY1 });
    const presented = applyReportsCompletenessToBundle(
      coreFromRange(range),
      resolveReportsFinancialReadiness({
        hydrationStage: "complete",
        salesHistoryHydration: null,
        authority: "live",
      }),
      null,
    );
    expect(presented).toMatchObject({
      ...REPORTS_DATA_COMPLETE_FLAGS,
      revenue: 50_000,
      count: 2,
      profit: range.profitUgx,
      authority: "live",
    });
  });

  it("TEST 9 — archived range waits until remainder (archives) is ready", () => {
    const archived = sale("arch-1", 40_000, ARCHIVE_DAY);
    const active = sale("act-1", 10_000, DAY1);
    const pendingArchive = resolveReportsFinancialReadiness({
      hydrationStage: "interactive",
      salesHistoryHydration: null,
      authority: "live",
    });
    expect(pendingArchive.remainderReady).toBe(false);
    expect(pendingArchive.dataComplete).toBe(false);

    const withoutArchive = applyReportsCompletenessToBundle(
      coreFromRange(
        localGetRangeSummary([active], [product], [], [], [], { kind: "range", fromKey: ARCHIVE_DAY, toKey: DAY1 }),
      ),
      pendingArchive,
      null,
    );
    expect(withoutArchive.loading).toBe(true);
    expect(withoutArchive.revenue).toBe(0);

    const withArchive = localGetRangeSummary(
      [active, archived],
      [product],
      [],
      [],
      [],
      { kind: "range", fromKey: ARCHIVE_DAY, toKey: DAY1 },
    );
    const complete = applyReportsCompletenessToBundle(
      coreFromRange(withArchive),
      resolveReportsFinancialReadiness({
        hydrationStage: "complete",
        salesHistoryHydration: null,
        authority: "live",
      }),
      null,
    );
    expect(complete.dataComplete).toBe(true);
    expect(complete.revenue).toBe(50_000);
    expect(complete.count).toBe(2);
  });

  it("TEST 10 — a known incomplete-load error does not present the first page as complete", () => {
    const failed = resolveReportsFinancialReadiness({
      hydrationStage: "complete",
      salesHistoryHydration: { active: true, loaded: 100, total: 500 },
      authority: "live",
    });
    expect(failed.dataComplete).toBe(false);
    expect(failed.canExport).toBe(false);
    expect(failed.loading).toBe(true);

    const presented = applyReportsCompletenessToBundle(
      coreFromRange(localGetRangeSummary(firstHundred, [product], [], [], [], { kind: "day", dateKey: DAY1 })),
      failed,
      null,
    );
    expect(presented.revenue).toBe(0);
    expect(presented.count).toBe(0);
    expect(presented.profit).toBe(0);
    expect(runReportsExportIfComplete(presented.dataComplete, () => "file")).toBeNull();
  });

  it("does not treat sales.length or a bare loading=false as completeness", () => {
    expect(
      resolveReportsDataCompleteness({
        hydrationStage: "complete",
        salesHistoryHydration: { active: true, loaded: 400, total: 400 },
      }).dataComplete,
    ).toBe(false);
    expect(
      resolveReportsDataCompleteness({
        hydrationStage: "interactive",
        salesHistoryHydration: null,
      }).dataComplete,
    ).toBe(false);
  });
});
