import { describe, expect, it } from "vitest";
import type { DayCloseSummary, Product, Sale } from "../types";
import { buildCashPositionDashboard } from "./cashPositionDashboard";
import {
  dayClosesForAuthority,
  resolvePeriodReportAuthority,
  resolveReportAuthority,
} from "./closedDayAuthority";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { localGetRangeSummary } from "./localReporting";

const DAY_A = "2026-04-10";
const DAY_B = "2026-08-12";
const DAY_C = "2026-08-13";

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

function sale(id: string, totalUgx: number, dateKey: string, liveCash = totalUgx): Sale {
  return {
    id,
    createdAt: `${dateKey}T10:00:00.000Z`,
    updatedAt: `${dateKey}T10:00:00.000Z`,
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: liveCash,
    debtUgx: 0,
    paymentMethod: "cash",
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
        updatedAt: `${dateKey}T10:00:00.000Z`,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    status: "completed",
  };
}

function closeFor(params: {
  id: string;
  dateKey: string;
  salesUgx: number;
  profitUgx: number;
  expectedCashUgx: number;
  countedCashUgx: number;
  cashFromSalesUgx: number;
  debtCollectedUgx: number;
  expenseUgx: number;
  supplierPaymentsUgx: number;
  adjustmentInflowsUgx: number;
  adjustmentOutflowsUgx: number;
  refundsUgx: number;
  supersededAt?: string | null;
}): DayCloseSummary {
  const differenceUgx = params.countedCashUgx - params.expectedCashUgx;
  const row = {
    id: params.id,
    dateKey: params.dateKey,
    expectedCashUgx: params.expectedCashUgx,
    countedCashUgx: params.countedCashUgx,
    differenceUgx,
    totalSalesUgx: params.salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: params.profitUgx,
    openingFloatUgx: 20_000,
    createdAt: `${params.dateKey}T18:00:00.000Z`,
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
        debtCollectedUgx: params.debtCollectedUgx,
        refundsUgx: params.refundsUgx,
        expenseUgx: params.expenseUgx,
        openingFloatUgx: 20_000,
        cashSalesUgx: params.cashFromSalesUgx,
        supplierPaymentsUgx: params.supplierPaymentsUgx,
        adjustmentInflowsUgx: params.adjustmentInflowsUgx,
        adjustmentOutflowsUgx: params.adjustmentOutflowsUgx,
        cashRefundsUgx: params.refundsUgx,
      },
      transactionCount: 1,
    }),
    supersededAt: params.supersededAt ?? null,
    pendingSync: false,
    updatedAt: `${params.dateKey}T18:00:00.000Z`,
  };
}

const archivedA = closeFor({
  id: "arch-a",
  dateKey: DAY_A,
  salesUgx: 500_000,
  profitUgx: 200_000,
  expectedCashUgx: 410_000,
  countedCashUgx: 405_000,
  cashFromSalesUgx: 380_000,
  debtCollectedUgx: 25_000,
  expenseUgx: 8_000,
  supplierPaymentsUgx: 12_000,
  adjustmentInflowsUgx: 5_000,
  adjustmentOutflowsUgx: 15_000,
  refundsUgx: 3_000,
});

const activeA = closeFor({
  id: "active-a",
  dateKey: DAY_A,
  salesUgx: 100_000,
  profitUgx: 40_000,
  expectedCashUgx: 130_000,
  countedCashUgx: 130_000,
  cashFromSalesUgx: 30_000,
  debtCollectedUgx: 0,
  expenseUgx: 0,
  supplierPaymentsUgx: 0,
  adjustmentInflowsUgx: 0,
  adjustmentOutflowsUgx: 0,
  refundsUgx: 0,
});

const activeB = closeFor({
  id: "active-b",
  dateKey: DAY_B,
  salesUgx: 80_000,
  profitUgx: 32_000,
  expectedCashUgx: 90_000,
  countedCashUgx: 90_000,
  cashFromSalesUgx: 70_000,
  debtCollectedUgx: 0,
  expenseUgx: 0,
  supplierPaymentsUgx: 0,
  adjustmentInflowsUgx: 0,
  adjustmentOutflowsUgx: 0,
  refundsUgx: 0,
});

function cashDash(opts: {
  filter: { kind: "day"; dateKey: string } | { kind: "range"; fromKey: string; toKey: string };
  sales: Sale[];
  dayCloses: DayCloseSummary[];
  todayKey: string;
}) {
  return buildCashPositionDashboard({
    lang: "en",
    filter: opts.filter,
    shopName: "Waka",
    sales: opts.sales,
    products: [product],
    returnRecords: [],
    debtPayments: [],
    cashExpenses: [],
    supplierPayments: [],
    cashDrawerAdjustments: [],
    shifts: [],
    dayDrawerOpens: [],
    dayCloses: opts.dayCloses,
    formulaVersion: "v2",
    staffAccounts: [],
    generalCategoryLabel: "General",
    todayKey: opts.todayKey,
  });
}

describe("P2-NEW-01 + P2-NEW-02 archived day-close authority", () => {
  it("TEST 1 — active close still wins over archived for the same date", () => {
    const merged = dayClosesForAuthority([activeA], [archivedA]);
    const auth = resolveReportAuthority(merged, DAY_A);
    expect(auth.closed).toBe(true);
    expect(auth.snapshot?.id).toBe("active-a");
    expect(auth.frozenTotals?.totalSalesUgx).toBe(100_000);
    expect(auth.frozenTotals?.cashFromSalesUgx).toBe(30_000);
  });

  it("TEST 2 — archived close is authoritative when no active close exists", () => {
    const merged = dayClosesForAuthority([], [archivedA]);
    const auth = resolveReportAuthority(merged, DAY_A);
    expect(auth.closed).toBe(true);
    expect(auth.snapshot?.id).toBe("arch-a");
    expect(auth.frozenTotals?.totalSalesUgx).toBe(500_000);
    expect(auth.source).toBe("closed_snapshot");
  });

  it("TEST 3 — Cash Position uses archived frozen values, not live leftovers", () => {
    const liveLeftover = sale("live-a", 9_000, DAY_A, 9_000);
    const merged = dayClosesForAuthority([], [archivedA]);
    const dash = cashDash({
      filter: { kind: "day", dateKey: DAY_A },
      sales: [liveLeftover],
      dayCloses: merged,
      todayKey: DAY_C,
    });
    expect(dash.report.ledgerClosed).toBe(true);
    expect(dash.report.summary.totalSalesUgx).toBe(500_000);
    expect(dash.report.cashPosition.expectedCashUgx).toBe(410_000);
    expect(dash.drawerStatus?.countedCashUgx).toBe(405_000);
    expect(dash.drawerStatus?.varianceUgx).toBe(-5_000);
    expect(dash.report.cashPosition.cashSalesUgx).toBe(380_000);
    expect(dash.report.cashPosition.debtCollectedUgx).toBe(25_000);
    expect(dash.report.cashPosition.expensesUgx).toBe(8_000);
    expect(dash.report.cashPosition.supplierPaymentsUgx).toBe(12_000);
    expect(dash.report.cashPosition.adjustmentInflowsUgx).toBe(5_000);
    expect(dash.report.cashPosition.adjustmentOutflowsUgx).toBe(15_000);
    expect(dash.report.cashPosition.refundsUgx).toBe(3_000);
    expect(dash.report.summary.totalSalesUgx).not.toBe(9_000);
    expect(dash.report.cashPosition.cashSalesUgx).not.toBe(9_000);
  });

  it("TEST 4 — All Time resolves archived A, active B, and open C independently", () => {
    const openSale = sale("open-c", 20_000, DAY_C, 20_000);
    const merged = dayClosesForAuthority([activeB], [archivedA]);
    expect(resolveReportAuthority(merged, DAY_A).snapshot?.id).toBe("arch-a");
    expect(resolveReportAuthority(merged, DAY_B).snapshot?.id).toBe("active-b");
    expect(resolveReportAuthority(merged, DAY_C).closed).toBe(false);
    expect(resolvePeriodReportAuthority(merged, { fromKey: DAY_A, toKey: DAY_C, isSingleDay: false })).toBe("mixed");

    const dash = cashDash({
      filter: { kind: "range", fromKey: DAY_A, toKey: DAY_C },
      sales: [openSale],
      dayCloses: merged,
      todayKey: DAY_C,
    });
    expect(dash.report.summary.totalSalesUgx).toBe(500_000 + 80_000 + 20_000);
    expect(dash.report.cashPosition.cashSalesUgx).toBe(380_000 + 70_000 + 20_000);
  });

  it("TEST 5 — mixed range does not double-count a date present in both buckets", () => {
    const merged = dayClosesForAuthority([activeA], [archivedA]);
    const dash = cashDash({
      filter: { kind: "day", dateKey: DAY_A },
      sales: [],
      dayCloses: merged,
      todayKey: DAY_C,
    });
    expect(dash.report.summary.totalSalesUgx).toBe(100_000);
    expect(dash.report.cashPosition.cashSalesUgx).toBe(30_000);
    expect(dash.report.cashPosition.expectedCashUgx).toBe(130_000);
  });

  it("TEST 6 — Reports overlay uses archived close even when archived sales are present", () => {
    const archivedSale = sale("arch-sale", 9_000, DAY_A, 9_000);
    const merged = dayClosesForAuthority([], [archivedA]);
    const report = localGetRangeSummary(
      [archivedSale],
      [product],
      [],
      [],
      [],
      { kind: "day", dateKey: DAY_A },
      [],
      merged,
    );
    expect(report.authority).toBe("closed_snapshot");
    expect(report.summary.totalRevenueUgx).toBe(500_000);
    expect(report.profitUgx).toBe(200_000);
    expect(report.summary.totalRevenueUgx).not.toBe(9_000);
  });

  it("TEST 7 — missing active and archived close stays non-authoritative", () => {
    const live = sale("live", 9_000, DAY_A, 9_000);
    const merged = dayClosesForAuthority([], []);
    const auth = resolveReportAuthority(merged, DAY_A);
    expect(auth.closed).toBe(false);
    expect(auth.liveTotalsAllowed).toBe(true);
    expect(auth.frozenTotals).toBeNull();
    const dash = cashDash({
      filter: { kind: "day", dateKey: DAY_A },
      sales: [live],
      dayCloses: merged,
      todayKey: DAY_A,
    });
    expect(dash.report.ledgerClosed).toBeFalsy();
    expect(dash.report.summary.totalSalesUgx).toBe(9_000);
  });

  it("TEST 8 — superseded archived close cannot become authoritative", () => {
    const superseded = { ...archivedA, id: "arch-super", supersededAt: `${DAY_A}T19:00:00.000Z` };
    const merged = dayClosesForAuthority([], [superseded]);
    const auth = resolveReportAuthority(merged, DAY_A);
    expect(auth.closed).toBe(false);
    expect(auth.snapshot).toBeNull();
    expect(auth.liveTotalsAllowed).toBe(true);
  });
});
