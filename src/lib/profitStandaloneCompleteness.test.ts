import { describe, expect, it } from "vitest";
import type { DayCloseSummary, Product, ReturnRecord, Sale, SaleLine } from "../types";
import {
  dayClosesForAuthority,
  overlayPeriodFinancials,
  resolvePeriodReportAuthority,
} from "./closedDayAuthority";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { resolveDateFilterBounds } from "./dateFilters";
import { computeProfitGroupedByCategory, mergeLinkedReturnsForScopedSales } from "./homeProfit";
import { presentProfitPageFinancials, presentProfitShelfRanking } from "./profitPageView";
import { resolveProfitPageDateAuthority } from "./profitPageDateAuthority";
import {
  canExportReportsData,
  resolveReportsFinancialReadiness,
  runReportsExportIfComplete,
  sumFrozenPeriodHeadlines,
} from "./reportsDataCompleteness";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";

const DAY1 = "2026-08-12";
const DAY2 = "2026-08-13";

const product: Product = {
  id: "prod-1",
  name: "Widget",
  sellingPricePerUnitUgx: 100_000,
  costPricePerUnitUgx: 60_000,
  stockOnHand: 50,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: `${DAY1}T09:00:00.000Z`,
  version: 1,
};

const productById = new Map([[product.id, product]]);

function line(total: number, unitCost = 60_000): SaleLine {
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

function sale(id: string, totalUgx: number, day: string, unitCost = 60_000): Sale {
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
    estimatedProfitUgx: totalUgx - unitCost,
    lines: [line(totalUgx, unitCost)],
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
    cogsUgx: Math.round((60_000 * refundAmountUgx) / 100_000),
  };
}

function closeFor(params: {
  dateKey: string;
  salesUgx: number;
  profitUgx: number;
  txn: number;
  id?: string;
}): DayCloseSummary {
  const createdAt = `${params.dateKey}T18:00:00.000Z`;
  const row = {
    id: params.id ?? `close-${params.dateKey}`,
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

function standaloneBounds(filter: { kind: "day"; dateKey: string } | { kind: "range"; fromKey: string; toKey: string }) {
  return resolveProfitPageDateAuthority({
    localFilter: filter,
  }).bounds;
}

function presentStandalone(input: {
  hydrationStage: "interactive" | "background" | "complete";
  salesHistoryHydration?: { active: boolean; loaded?: number; total?: number } | null;
  sales: Sale[];
  returns?: ReturnRecord[];
  dayCloses?: DayCloseSummary[];
  filter?: { kind: "day"; dateKey: string } | { kind: "range"; fromKey: string; toKey: string };
}) {
  const bounds = standaloneBounds(input.filter ?? { kind: "day", dateKey: DAY1 });
  const filteredSales = input.sales;
  const allReturns = input.returns ?? [];
  const profitReturns = mergeLinkedReturnsForScopedSales(filteredSales, allReturns, allReturns);
  const report = computeProfitGroupedByCategory(filteredSales, productById, "General", profitReturns);
  const dayCloses = input.dayCloses ?? [];
  const periodAuthority = resolvePeriodReportAuthority(dayCloses, bounds);
  const closedPeriod = periodAuthority !== "live";
  const overlaid = overlayPeriodFinancials({
    live: {
      revenueUgx: report.total.salesUgx,
      profitUgx: report.total.profitUgx,
      transactionCount: filteredSales.length,
      debtIssuedUgx: 0,
    },
    dayCloses,
    bounds,
    sales: filteredSales,
    returns: profitReturns,
    products: [product],
  });
  const readiness = resolveReportsFinancialReadiness({
    hydrationStage: input.hydrationStage,
    salesHistoryHydration: input.salesHistoryHydration ?? null,
    authority: periodAuthority,
  });
  const frozenHeadlines = readiness.canShowFrozenHeadlines
    ? sumFrozenPeriodHeadlines(dayCloses, bounds)
    : null;
  const presentation = presentProfitPageFinancials({
    readiness,
    overlaid,
    liveCostUgx: report.total.costUgx,
    closedPeriod,
    frozenHeadlines,
  });
  const shelf = presentProfitShelfRanking({
    authority: periodAuthority,
    groups: report.groups,
    liveTotalProfitUgx: report.total.profitUgx,
  });
  return {
    bounds,
    periodAuthority,
    readiness,
    overlaid,
    live: report.total,
    groups: report.groups,
    presentation,
    shelf,
    frozenHeadlines,
  };
}

function exportBundle(dataComplete: boolean) {
  return {
    csv: runReportsExportIfComplete(dataComplete, () => "csv"),
    pdf: runReportsExportIfComplete(dataComplete, () => "pdf"),
    print: runReportsExportIfComplete(dataComplete, () => "print"),
    share: runReportsExportIfComplete(dataComplete, () => "share"),
  };
}

describe("P2-NEW-03 standalone Profit completeness", () => {
  it("TEST 1 — incomplete open period does not present partial headlines or rankings as complete", () => {
    const partial = sale("s-partial", 100_000, DAY1);
    const presented = presentStandalone({
      hydrationStage: "interactive",
      salesHistoryHydration: { active: true, loaded: 1, total: 5 },
      sales: [partial],
    });

    expect(presented.periodAuthority).toBe("live");
    expect(presented.live.profitUgx).toBe(40_000);
    expect(presented.live.salesUgx).toBe(100_000);
    expect(presented.readiness.dataComplete).toBe(false);
    expect(presented.readiness.canShowLiveFinancials).toBe(false);
    expect(presented.presentation.presentHeadlinesAsComplete).toBe(false);
    expect(presented.presentation.showHeadlineSkeleton).toBe(true);
    expect(presented.presentation.showLiveBreakdowns).toBe(false);
    expect(presented.presentation.headlineSource).toBe("hidden");
    expect(presented.presentation.canExport).toBe(false);
    expect(presented.shelf.kind).toBe("open");
    expect(presented.presentation.showLiveBreakdowns).toBe(false);
  });

  it("TEST 2 — incomplete return hydration does not show pre-return profit as final", () => {
    const original = sale("s-day1", 100_000, DAY1);
    const presented = presentStandalone({
      hydrationStage: "interactive",
      salesHistoryHydration: null,
      sales: [original],
      returns: [],
    });

    expect(presented.live.profitUgx).toBe(40_000);
    expect(presented.readiness.dataComplete).toBe(false);
    expect(presented.readiness.remainderReady).toBe(false);
    expect(presented.presentation.presentHeadlinesAsComplete).toBe(false);
    expect(presented.presentation.showHeadlineSkeleton).toBe(true);
    expect(presented.presentation.headlineProfitUgx).toBe(0);
    expect(presented.presentation.headlineProfitUgx).not.toBe(40_000);
  });

  it("TEST 3 — export is blocked while incomplete", () => {
    const presented = presentStandalone({
      hydrationStage: "background",
      salesHistoryHydration: { active: true, loaded: 1, total: 3 },
      sales: [sale("s1", 100_000, DAY1)],
    });

    expect(canExportReportsData(presented.readiness)).toBe(false);
    expect(presented.presentation.canExport).toBe(false);
    expect(exportBundle(presented.readiness.dataComplete)).toEqual({
      csv: null,
      pdf: null,
      print: null,
      share: null,
    });
  });

  it("TEST 4 — complete period headlines stay identical to the existing overlay", () => {
    const open = [sale("s1", 100_000, DAY1), sale("s2", 50_000, DAY1, 20_000)];
    const presented = presentStandalone({
      hydrationStage: "complete",
      salesHistoryHydration: null,
      sales: open,
    });

    expect(presented.readiness.dataComplete).toBe(true);
    expect(presented.presentation.headlineSource).toBe("overlay");
    expect(presented.presentation.presentHeadlinesAsComplete).toBe(true);
    expect(presented.presentation.showLiveBreakdowns).toBe(true);
    expect(presented.presentation.headlineRevenueUgx).toBe(presented.overlaid.revenueUgx);
    expect(presented.presentation.headlineProfitUgx).toBe(presented.overlaid.profitUgx);
    expect(presented.presentation.headlineRevenueUgx).toBe(150_000);
    expect(presented.presentation.headlineProfitUgx).toBe(70_000);
    expect(presented.presentation.headlineCostUgx).toBe(80_000);
    expect(canExportReportsData(presented.readiness)).toBe(true);
    expect(exportBundle(true)).toEqual({
      csv: "csv",
      pdf: "pdf",
      print: "print",
      share: "share",
    });
  });

  it("TEST 5 — fully closed incomplete uses frozen headlines and keeps products unavailable", () => {
    const close = closeFor({ dateKey: DAY1, salesUgx: 500_000, profitUgx: 200_000, txn: 50 });
    const livePartial = sale("closed-partial", 100_000, DAY1);
    const presented = presentStandalone({
      hydrationStage: "complete",
      salesHistoryHydration: { active: true, loaded: 1, total: 50 },
      sales: [livePartial],
      dayCloses: [close],
    });

    expect(presented.periodAuthority).toBe("closed_snapshot");
    expect(presented.readiness.dataComplete).toBe(false);
    expect(presented.readiness.canShowFrozenHeadlines).toBe(true);
    expect(presented.presentation.headlineSource).toBe("frozen");
    expect(presented.presentation.showHeadlineSkeleton).toBe(false);
    expect(presented.presentation.headlineRevenueUgx).toBe(500_000);
    expect(presented.presentation.headlineProfitUgx).toBe(200_000);
    expect(presented.presentation.headlineCostUgx).toBe(300_000);
    expect(presented.presentation.headlineRevenueUgx).not.toBe(presented.live.salesUgx);
    expect(presented.presentation.showLiveBreakdowns).toBe(false);
    expect(presented.shelf).toEqual({ kind: "unavailable" });
    expect(canExportReportsData(presented.readiness)).toBe(false);
  });

  it("TEST 6 — archived closed authority is used; live partial does not replace it", () => {
    const archived = closeFor({
      dateKey: DAY1,
      salesUgx: 250_000,
      profitUgx: 90_000,
      txn: 8,
      id: "archived-close",
    });
    const merged = dayClosesForAuthority([], [archived]);
    const livePartial = sale("arch-live", 10_000, DAY1);
    const presented = presentStandalone({
      hydrationStage: "interactive",
      sales: [livePartial],
      dayCloses: merged,
    });

    expect(presented.periodAuthority).toBe("closed_snapshot");
    expect(presented.frozenHeadlines?.revenue).toBe(250_000);
    expect(presented.presentation.headlineSource).toBe("frozen");
    expect(presented.presentation.headlineRevenueUgx).toBe(250_000);
    expect(presented.presentation.headlineProfitUgx).toBe(90_000);
    expect(presented.presentation.headlineRevenueUgx).not.toBe(10_000);
    expect(presented.presentation.showLiveBreakdowns).toBe(false);
    expect(presented.shelf).toEqual({ kind: "unavailable" });
  });

  it("TEST 7 — linked return after complete hydration keeps the established P1-02 result", () => {
    const original = sale("s1", 100_000, DAY1);
    const linked = linkedReturn("r1", original.id, DAY2, 100_000);
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 100_000) };
    const presented = presentStandalone({
      hydrationStage: "complete",
      salesHistoryHydration: null,
      sales: [adjusted],
      returns: [linked],
    });

    expect(presented.readiness.dataComplete).toBe(true);
    expect(presented.presentation.headlineSource).toBe("overlay");
    expect(presented.presentation.headlineRevenueUgx).toBe(0);
    expect(presented.presentation.headlineProfitUgx).toBe(0);
    expect(presented.presentation.headlineCostUgx).toBe(0);
    expect(presented.live.salesUgx).toBe(0);
    expect(presented.live.costUgx).toBe(0);
    expect(presented.live.profitUgx).toBe(0);
  });

  it("standalone completeness uses Profit's own date bounds, not a Reports-shell filter", () => {
    const day1 = standaloneBounds({ kind: "day", dateKey: DAY1 });
    const range = standaloneBounds({ kind: "range", fromKey: DAY1, toKey: DAY2 });
    const reportsShell = resolveDateFilterBounds({ kind: "day", dateKey: DAY2 });
    expect(day1.fromKey).toBe(DAY1);
    expect(day1.toKey).toBe(DAY1);
    expect(range.fromKey).toBe(DAY1);
    expect(range.toKey).toBe(DAY2);
    expect(day1.fromKey).not.toBe(reportsShell.fromKey);
  });
});
