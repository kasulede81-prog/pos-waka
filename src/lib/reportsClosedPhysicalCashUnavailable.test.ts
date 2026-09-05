import { describe, expect, it } from "vitest";
import type { DayCloseDocumentSnapshot, DayCloseSummary, Product, Sale } from "../types";
import { buildAnalyticsReportRows } from "./analyticsReportExport";
import {
  hasAuthoritativeClosedPhysicalCash,
  overlayPeriodFinancials,
  periodClosedPhysicalCashUnavailable,
  readClosedDayTotals,
  resolveReportAuthority,
} from "./closedDayAuthority";
import { buildDailyReportDocument } from "./dailyReportPdf";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { t } from "./i18n";
import { localGetRangeSummary } from "./localReporting";
import { buildDailyReportText } from "./reportExport";
import { REPORTS_DATA_COMPLETE_FLAGS, sumFrozenPeriodHeadlines } from "./reportsDataCompleteness";
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
    estimatedProfitUgx: extras.estimatedProfitUgx ?? totalUgx - 40_000,
    tenderCashUgx: extras.tenderCashUgx,
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: totalUgx,
        unitCostUgx: 40_000,
        lineTotalUgx: totalUgx,
        estimatedProfitUgx: extras.estimatedProfitUgx ?? totalUgx - 40_000,
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

/** Mixed tender: collected 50k is not physical cash (30k). */
function mixedTenderSale(id: string, createdAt: string, tenderCashUgx?: number): Sale {
  return sale(id, 100_000, createdAt, {
    cashPaidUgx: 50_000,
    debtUgx: 50_000,
    paymentMethod: "mixed",
    tenderCashUgx,
  });
}

function closeFor(params: {
  dateKey: string;
  salesUgx: number;
  cashFromSalesUgx?: number | null;
  omitCashFromSales?: boolean;
  nullCashFromSales?: boolean;
  expectedCashUgx?: number;
  countedCashUgx?: number;
  profitUgx?: number;
  debtUgx?: number;
  expenseUgx?: number;
  txn?: number;
}): DayCloseSummary {
  const createdAt = `${params.dateKey}T18:00:00.000Z`;
  const expectedCashUgx = params.expectedCashUgx ?? 80_000;
  const countedCashUgx = params.countedCashUgx ?? 75_000;
  const row = {
    id: `close-${params.dateKey}`,
    dateKey: params.dateKey,
    expectedCashUgx,
    countedCashUgx,
    differenceUgx: countedCashUgx - expectedCashUgx,
    totalSalesUgx: params.salesUgx,
    totalDebtUgx: params.debtUgx ?? 50_000,
    profitEstimateUgx: params.profitUgx ?? 40_000,
    openingFloatUgx: 0,
    createdAt,
    closedByUserId: "owner",
    closedByLabel: "Owner",
  };
  const cashForBuild = params.cashFromSalesUgx ?? 0;
  const documentSnapshot = buildDayCloseSnapshot({
    closedByUserId: "owner",
    closedByLabel: "Owner",
    row,
    drawer: {
      cashFromSalesUgx: cashForBuild,
      debtCollectedUgx: 0,
      refundsUgx: 0,
      expenseUgx: params.expenseUgx ?? 12_000,
      openingFloatUgx: 0,
      cashSalesUgx: cashForBuild,
      supplierPaymentsUgx: 0,
      adjustmentInflowsUgx: 0,
      adjustmentOutflowsUgx: 0,
      cashRefundsUgx: 0,
    },
    transactionCount: params.txn ?? 1,
  });
  let snap: DayCloseDocumentSnapshot | (Omit<DayCloseDocumentSnapshot, "cashFromSalesUgx"> & {
    cashFromSalesUgx?: number | null;
  }) = documentSnapshot;
  if (params.omitCashFromSales) {
    const { cashFromSalesUgx: _dropped, ...rest } = documentSnapshot;
    snap = rest;
  } else if (params.nullCashFromSales) {
    snap = { ...documentSnapshot, cashFromSalesUgx: null };
  } else if (params.cashFromSalesUgx != null) {
    snap = { ...documentSnapshot, cashFromSalesUgx: params.cashFromSalesUgx, cashSalesUgx: params.cashFromSalesUgx };
  }
  return {
    ...row,
    documentSnapshot: snap as DayCloseDocumentSnapshot,
    supersededAt: null,
    pendingSync: false,
    updatedAt: createdAt,
  };
}

function presentedBundle(range: ReturnType<typeof localGetRangeSummary>): ShopReportBundle {
  const summary = range.summary;
  const rawCash = "cashCollectedUgx" in summary ? summary.cashCollectedUgx : 0;
  return {
    source: "local",
    authority: range.authority,
    closedDayBreakdownUnavailable: range.closedDayBreakdownUnavailable,
    physicalCashUnavailable: range.closedDayPhysicalCashUnavailable,
    revenue: summary.totalRevenueUgx,
    cash: range.closedDayPhysicalCashUnavailable ? 0 : rawCash,
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

function exportCashInHand(range: ReturnType<typeof localGetRangeSummary>): string | number | undefined {
  const rows = buildAnalyticsReportRows({
    lang: "en",
    title: "Reports",
    periodLabel: DAY_A,
    report: presentedBundle(range),
    expensesUgx: 12_000,
    purchasesInPeriodUgx: 0,
    canProfit: true,
  });
  return rows.find((row) => row[0] === t("en", "cashInHand"))?.[1];
}

function dailyCashInHandLine(sales: Sale[], close: DayCloseSummary | undefined, day = DAY_A): string {
  const text = buildDailyReportText("en", day, {
    sales,
    products: [product],
    returnRecords: [],
    dayCloses: close ? [close] : [],
  });
  return text.split("\n").find((line) => line.startsWith(`${t("en", "cashInHand")}:`)) ?? "";
}

describe("RPT-P2-07 legacy closed snapshot physical cash fail-closed", () => {
  const at = `${DAY_A}T10:00:00.000Z`;
  const openAt = `${DAY_B}T10:00:00.000Z`;
  const mixedLive = mixedTenderSale("mix", at, 30_000);
  const mixedAmbiguous = mixedTenderSale("mix-amb", at);
  const openSale = sale("open", 20_000, openAt, { tenderCashUgx: 20_000, cashPaidUgx: 20_000 });

  it("TEST 1 — missing cashFromSalesUgx is unavailable, not cashCollectedUgx 50,000", () => {
    const close = closeFor({ dateKey: DAY_A, salesUgx: 100_000, omitCashFromSales: true });
    expect(readClosedDayTotals(close).cashFromSalesUgx).toBeNull();
    expect(hasAuthoritativeClosedPhysicalCash(readClosedDayTotals(close))).toBe(false);

    const range = localGetRangeSummary(
      [mixedLive],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_A },
      [],
      [close],
    );
    expect(range.closedDayPhysicalCashUnavailable).toBe(true);
    expect(presentedBundle(range).physicalCashUnavailable).toBe(true);
    expect(exportCashInHand(range)).toBe(t("en", "reportsClosedBreakdownUnavailable"));
    expect(exportCashInHand(range)).not.toBe(50_000);
    expect(range.summary.totalRevenueUgx).toBe(100_000);
  });

  it("TEST 2 — null cashFromSalesUgx is unavailable", () => {
    const close = closeFor({ dateKey: DAY_A, salesUgx: 100_000, nullCashFromSales: true });
    expect(readClosedDayTotals(close).cashFromSalesUgx).toBeNull();
    expect(
      periodClosedPhysicalCashUnavailable([close], { fromKey: DAY_A, toKey: DAY_A, isSingleDay: true }),
    ).toBe(true);

    const range = localGetRangeSummary(
      [mixedLive],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_A },
      [],
      [close],
    );
    expect(range.closedDayPhysicalCashUnavailable).toBe(true);
    expect(exportCashInHand(range)).toBe(t("en", "reportsClosedBreakdownUnavailable"));
  });

  it("TEST 3 — authoritative zero remains 0, not unavailable", () => {
    const close = closeFor({
      dateKey: DAY_A,
      salesUgx: 100_000,
      cashFromSalesUgx: 0,
      expectedCashUgx: 0,
      countedCashUgx: 0,
      debtUgx: 100_000,
    });
    expect(hasAuthoritativeClosedPhysicalCash(readClosedDayTotals(close))).toBe(true);
    expect(readClosedDayTotals(close).cashFromSalesUgx).toBe(0);

    const momo = sale("momo", 100_000, at, {
      paymentMethod: "mobile_money",
      cashPaidUgx: 100_000,
      debtUgx: 0,
      tenderCashUgx: 0,
    });
    const range = localGetRangeSummary(
      [momo],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_A },
      [],
      [close],
    );
    expect(range.closedDayPhysicalCashUnavailable).toBe(false);
    expect(range.summary.cashCollectedUgx).toBe(0);
    expect(presentedBundle(range).cash).toBe(0);
    expect(exportCashInHand(range)).toBe(0);
  });

  it("TEST 4 — authoritative 30,000 remains RPT-P1-01 physical cash", () => {
    const close = closeFor({
      dateKey: DAY_A,
      salesUgx: 100_000,
      cashFromSalesUgx: 30_000,
      expectedCashUgx: 30_000,
      countedCashUgx: 30_000,
    });
    const range = localGetRangeSummary(
      [mixedLive],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_A },
      [],
      [close],
    );
    expect(range.closedDayPhysicalCashUnavailable).toBe(false);
    expect(range.summary.cashCollectedUgx).toBe(30_000);
    expect(exportCashInHand(range)).toBe(30_000);
  });

  it("TEST 5 — mixed-tender legacy snapshot never reports cashPaidUgx 50,000", () => {
    const close = closeFor({ dateKey: DAY_A, salesUgx: 100_000, omitCashFromSales: true });
    const overlaid = overlayPeriodFinancials({
      live: {
        revenueUgx: 100_000,
        profitUgx: 40_000,
        transactionCount: 1,
        debtIssuedUgx: 50_000,
        cashCollectedUgx: 50_000,
      },
      dayCloses: [close],
      bounds: { fromKey: DAY_A, toKey: DAY_A, isSingleDay: true },
      sales: [mixedAmbiguous],
      returns: [],
      products: [product],
    });
    expect(overlaid.physicalCashUnavailable).toBe(true);

    const range = localGetRangeSummary(
      [mixedAmbiguous],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_A },
      [],
      [close],
    );
    expect(range.closedDayPhysicalCashUnavailable).toBe(true);
    expect(exportCashInHand(range)).not.toBe(50_000);
    expect(exportCashInHand(range)).toBe(t("en", "reportsClosedBreakdownUnavailable"));
  });

  it("TEST 6 — open day keeps live physical cash 30,000", () => {
    const range = localGetRangeSummary(
      [mixedLive],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_A },
      [],
      [],
    );
    expect(range.closedDayPhysicalCashUnavailable).toBe(false);
    expect(range.authority).toBe("live");
    expect(range.summary.cashCollectedUgx).toBe(30_000);
    expect(exportCashInHand(range)).toBe(30_000);
  });

  it("TEST 7 — mixed closed-missing + open 20,000 period cash is unavailable", () => {
    const close = closeFor({ dateKey: DAY_A, salesUgx: 100_000, omitCashFromSales: true });
    const range = localGetRangeSummary(
      [mixedLive, openSale],
      [product],
      [],
      [],
      [],
      { kind: "range", fromKey: DAY_A, toKey: DAY_B },
      [],
      [close],
    );
    expect(range.authority).toBe("mixed");
    expect(range.closedDayPhysicalCashUnavailable).toBe(true);
    expect(presentedBundle(range).cash).toBe(0);
    expect(exportCashInHand(range)).toBe(t("en", "reportsClosedBreakdownUnavailable"));
    expect(exportCashInHand(range)).not.toBe(20_000);
    expect(exportCashInHand(range)).not.toBe(50_000);
  });

  it("TEST 8 — other closed headlines stay available", () => {
    const close = closeFor({
      dateKey: DAY_A,
      salesUgx: 100_000,
      omitCashFromSales: true,
      profitUgx: 40_000,
      debtUgx: 50_000,
      expenseUgx: 12_000,
      txn: 1,
    });
    const range = localGetRangeSummary(
      [mixedLive],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_A },
      [],
      [close],
    );
    expect(range.closedDayPhysicalCashUnavailable).toBe(true);
    expect(range.summary.totalRevenueUgx).toBe(100_000);
    expect(range.summary.transactionCount).toBe(1);
    expect(range.profitUgx).toBe(40_000);
    expect("debtIssuedUgx" in range.summary && range.summary.debtIssuedUgx).toBe(50_000);
    expect(readClosedDayTotals(close).expenseUgx).toBe(12_000);
    expect(sumFrozenPeriodHeadlines([close], { fromKey: DAY_A, toKey: DAY_A, isSingleDay: true })).toEqual(
      expect.objectContaining({
        revenue: 100_000,
        profit: 40_000,
        count: 1,
        debt: 50_000,
        cashUnavailable: true,
      }),
    );
  });

  it("TEST 9 — expected cash stays numeric from the close row (Case A)", () => {
    const close = closeFor({
      dateKey: DAY_A,
      salesUgx: 100_000,
      omitCashFromSales: true,
      expectedCashUgx: 80_000,
      countedCashUgx: 75_000,
    });
    const tot = readClosedDayTotals(close);
    expect(tot.cashFromSalesUgx).toBeNull();
    expect(tot.expectedCashUgx).toBe(80_000);
  });

  it("TEST 10 — variance stays numeric from the close row", () => {
    const close = closeFor({
      dateKey: DAY_A,
      salesUgx: 100_000,
      omitCashFromSales: true,
      expectedCashUgx: 80_000,
      countedCashUgx: 75_000,
    });
    const tot = readClosedDayTotals(close);
    expect(tot.varianceUgx).toBe(-5_000);
    expect(resolveReportAuthority([close], DAY_A).frozenTotals?.varianceUgx).toBe(-5_000);
  });

  it("TEST 11 — report export does not emit a false numeric physical-cash value", () => {
    const close = closeFor({ dateKey: DAY_A, salesUgx: 100_000, omitCashFromSales: true });
    const range = localGetRangeSummary(
      [mixedAmbiguous],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_A },
      [],
      [close],
    );
    const cashCell = exportCashInHand(range);
    expect(cashCell).toBe(t("en", "reportsClosedBreakdownUnavailable"));
    expect(cashCell).not.toBe(0);
    expect(cashCell).not.toBe(50_000);
    expect(cashCell).not.toBe(30_000);
  });

  it("TEST 12 — daily PDF/text do not substitute cashCollectedUgx", () => {
    const close = closeFor({ dateKey: DAY_A, salesUgx: 100_000, omitCashFromSales: true });
    const line = dailyCashInHandLine([mixedAmbiguous], close);
    expect(line).toContain(t("en", "reportsClosedBreakdownUnavailable"));
    expect(line).not.toContain("50,000");

    const doc = buildDailyReportDocument({
      lang: "en",
      dateKey: DAY_A,
      shopName: "Waka",
      sales: [mixedAmbiguous],
      products: [product],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      topProducts: [],
      dayCloses: [close],
    });
    const cashRow = doc.sections[0]?.rows.find((row) => row.label === t("en", "cashInHand"));
    expect(cashRow?.value).toBe(t("en", "reportsClosedBreakdownUnavailable"));
    const expectedRow = doc.sections[0]?.rows.find((row) => row.label === t("en", "ownerCardExpectedCash"));
    expect(expectedRow?.value).toContain("80,000");
  });
});
