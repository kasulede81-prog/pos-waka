import { describe, expect, it } from "vitest";
import type { DayCloseSummary, Product, Sale, ShopPreferences } from "../types";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import {
  applyClosedDayToCashPositionReport,
  collapseDuplicateActiveCloses,
  overlayPeriodFinancials,
  preserveFrozenCloseFields,
  readClosedDayTotals,
} from "./closedDayAuthority";
import { applySuccessfulDayClosePush } from "./dayCloseCloudSync";
import { canRecordDayClose } from "./dayCloseIdempotency";
import { mergeDayClosePair, mergeDayClosesFromCloudPull } from "./dayCloseRecovery";
import { buildCashPositionReport } from "./cashPosition";
import { buildCashPositionDashboard } from "./cashPositionDashboard";
import { buildXReportSnapshot } from "./xReport";
import { localGetDailySalesSummary } from "./localReporting";
import { dateKeyKampala } from "./datesUg";
import { getCompletedFinancials } from "./financialMetrics";

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

function sale(id: string, totalUgx: number, createdAt: string): Sale {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    subtotalUgx: totalUgx,
    totalUgx,
    cashPaidUgx: totalUgx,
    debtUgx: 0,
    paymentMethod: "cash",
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
    openingFloatUgx: 0,
    createdAt: params.createdAt,
    closedByUserId: "owner",
    closedByLabel: "Owner",
  };
  const documentSnapshot = buildDayCloseSnapshot({
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
  });
  return {
    ...row,
    documentSnapshot,
    supersededAt: params.supersededAt ?? null,
    pendingSync: false,
    updatedAt: params.createdAt,
  };
}

const prefs = { shopDisplayName: "Waka", cashDrawerFormulaVersion: "v2", shifts: [] } as unknown as ShopPreferences;

function cashPositionInput(sales: Sale[], dayCloses: DayCloseSummary[], dayKey: string) {
  return {
    lang: "en" as const,
    filter: { kind: "day" as const, dateKey: dayKey },
    shopName: "Waka",
    sales,
    products: [product],
    returnRecords: [],
    debtPayments: [],
    cashExpenses: [],
    supplierPayments: [],
    cashDrawerAdjustments: [],
    shifts: [],
    dayDrawerOpens: [],
    dayCloses,
    formulaVersion: "v2" as const,
    staffAccounts: [],
    generalCategoryLabel: "General",
    todayKey: DAY_B,
  };
}

describe("CLOSE-DAY-1.1 one active close per shop/date", () => {
  it("keeps one active close for the same date and allows other dates", () => {
    const a1 = closeFor({
      id: "c-old",
      dateKey: DAY_A,
      salesUgx: 400_000,
      expectedCashUgx: 400_000,
      countedCashUgx: 400_000,
      profitUgx: 300_000,
      txn: 1,
      createdAt: `${DAY_A}T18:00:00.000Z`,
    });
    const a2 = closeFor({
      id: "c-new",
      dateKey: DAY_A,
      salesUgx: 500_000,
      expectedCashUgx: 500_000,
      countedCashUgx: 500_000,
      profitUgx: 400_000,
      txn: 1,
      createdAt: `${DAY_A}T19:00:00.000Z`,
    });
    const b = closeFor({
      id: "c-b",
      dateKey: DAY_B,
      salesUgx: 100_000,
      expectedCashUgx: 100_000,
      countedCashUgx: 100_000,
      profitUgx: 80_000,
      txn: 1,
      createdAt: `${DAY_B}T18:00:00.000Z`,
    });
    const collapsed = collapseDuplicateActiveCloses([a1, a2, b], `${DAY_B}T20:00:00.000Z`);
    const activeA = collapsed.filter((d) => d.dateKey === DAY_A && !d.supersededAt);
    expect(activeA).toHaveLength(1);
    expect(activeA[0]?.id).toBe("c-new");
    expect(collapsed.find((d) => d.id === "c-old")?.supersededAt).toBeTruthy();
    expect(collapsed.find((d) => d.id === "c-b")?.supersededAt).toBeFalsy();
  });

  it("does not delete superseded financial rows", () => {
    const a1 = closeFor({
      id: "keep-row",
      dateKey: DAY_A,
      salesUgx: 1,
      expectedCashUgx: 1,
      countedCashUgx: 1,
      profitUgx: 1,
      txn: 1,
      createdAt: `${DAY_A}T18:00:00.000Z`,
    });
    const a2 = closeFor({
      id: "newer",
      dateKey: DAY_A,
      salesUgx: 2,
      expectedCashUgx: 2,
      countedCashUgx: 2,
      profitUgx: 2,
      txn: 1,
      createdAt: `${DAY_A}T19:00:00.000Z`,
    });
    const collapsed = collapseDuplicateActiveCloses([a1, a2]);
    expect(collapsed).toHaveLength(2);
    expect(collapsed.find((d) => d.id === "keep-row")?.totalSalesUgx).toBe(1);
  });
});

describe("CLOSE-DAY-1.1 duplicate close request", () => {
  it("rejects a second close for the same date without override", () => {
    const existing = closeFor({
      id: "c1",
      dateKey: DAY_A,
      salesUgx: 500_000,
      expectedCashUgx: 500_000,
      countedCashUgx: 500_000,
      profitUgx: 400_000,
      txn: 1,
      createdAt: `${DAY_A}T18:00:00.000Z`,
    });
    expect(canRecordDayClose([existing], DAY_A)).toEqual({ ok: false, errorKey: "dayCloseAlreadyExists" });
    expect(canRecordDayClose([existing], DAY_B).ok).toBe(true);
  });

  it("treats an already-closed cloud push as success without a second active row", () => {
    const localExtra = closeFor({
      id: "retry",
      dateKey: DAY_A,
      salesUgx: 530_000,
      expectedCashUgx: 530_000,
      countedCashUgx: 530_000,
      profitUgx: 430_000,
      txn: 2,
      createdAt: `${DAY_A}T19:00:00.000Z`,
    });
    const authoritative = closeFor({
      id: "auth",
      dateKey: DAY_A,
      salesUgx: 500_000,
      expectedCashUgx: 500_000,
      countedCashUgx: 500_000,
      profitUgx: 400_000,
      txn: 1,
      createdAt: `${DAY_A}T18:00:00.000Z`,
    });
    const next = applySuccessfulDayClosePush([authoritative, localExtra], "retry", {
      ok: true,
      alreadyClosed: true,
      authoritativeId: "auth",
    });
    expect(next.filter((d) => !d.supersededAt)).toHaveLength(1);
    expect(next.find((d) => d.id === "auth")?.supersededAt).toBeFalsy();
    expect(next.find((d) => d.id === "retry")?.supersededAt).toBeTruthy();
    expect(next.find((d) => d.id === "auth")?.totalSalesUgx).toBe(500_000);
  });
});

describe("CLOSE-DAY-1.1 historical authority and late sale", () => {
  const closedSale = sale("s-a", 500_000, `${DAY_A}T10:00:00.000Z`);
  const lateSale = sale("s-late", 30_000, `${DAY_A}T16:00:00.000Z`);
  const close = closeFor({
    id: "close-a",
    dateKey: DAY_A,
    salesUgx: 500_000,
    expectedCashUgx: 500_000,
    countedCashUgx: 490_000,
    profitUgx: 400_000,
    txn: 1,
    createdAt: `${DAY_A}T18:00:00.000Z`,
  });

  it("keeps Day A historical headlines on the close snapshot after live data changes", () => {
    const live = getCompletedFinancials([closedSale, lateSale], [], [product], { day: DAY_A });
    expect(live.revenueUgx).toBe(530_000);

    const daily = localGetDailySalesSummary([closedSale, lateSale], [product], [], DAY_A, [close]);
    expect(daily.totalRevenueUgx).toBe(500_000);
    expect(daily.transactionCount).toBe(1);
    expect(daily.estimatedProfitUgx).toBe(400_000);

    const cashLive = buildCashPositionReport({
      lang: "en",
      dayKey: DAY_A,
      shopName: "Waka",
      sales: [closedSale, lateSale],
      products: [product],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      supplierPayments: [],
      cashDrawerAdjustments: [],
      shifts: [],
      dayDrawerOpens: [],
      formulaVersion: "v2",
      staffAccounts: [],
      generalCategoryLabel: "General",
    });
    expect(cashLive.summary.totalSalesUgx).toBe(530_000);
    const cashFrozen = applyClosedDayToCashPositionReport(cashLive, close);
    expect(cashFrozen.summary.totalSalesUgx).toBe(500_000);
    expect(cashFrozen.cashPosition.expectedCashUgx).toBe(500_000);

    const dash = buildCashPositionDashboard(cashPositionInput([closedSale, lateSale], [close], DAY_A));
    expect(dash.report.summary.totalSalesUgx).toBe(500_000);
    expect(dash.report.cashPosition.expectedCashUgx).toBe(500_000);
    expect(dash.extendedSummary.grossProfitUgx).toBe(400_000);
    expect(dash.drawerStatus?.countedCashUgx).toBe(490_000);
    expect(dash.drawerStatus?.expectedCashUgx).toBe(500_000);

    const x = buildXReportSnapshot({
      dateKey: DAY_A,
      shopName: "Waka",
      sales: [closedSale, lateSale],
      returns: [],
      products: [product],
      voidRecords: [],
      cashExpenses: [],
      debtPayments: [],
      supplierPayments: [],
      cashDrawerAdjustments: [],
      dayDrawerOpens: [],
      shifts: [],
      preferences: prefs,
      dayCloses: [close],
    });
    expect(x.totalSalesUgx).toBe(500_000);
    expect(x.expectedDrawerCashUgx).toBe(500_000);
    expect(x.profitEstimateUgx).toBe(400_000);
    expect(x.transactionCount).toBe(1);

    const tot = readClosedDayTotals(close);
    expect(dash.report.summary.totalSalesUgx).toBe(tot.totalSalesUgx);
    expect(x.totalSalesUgx).toBe(tot.totalSalesUgx);
    expect(daily.totalRevenueUgx).toBe(tot.totalSalesUgx);
    expect(dash.report.cashPosition.expectedCashUgx).toBe(tot.expectedCashUgx);
    expect(x.expectedDrawerCashUgx).toBe(tot.expectedCashUgx);
  });

  it("does not change Day A close totals when a Day-A sale is present on Day B", () => {
    const dayBSale = sale("s-b", 80_000, `${DAY_B}T10:00:00.000Z`);
    const all = [closedSale, lateSale, dayBSale];
    const dashA = buildCashPositionDashboard(cashPositionInput(all, [close], DAY_A));
    expect(dashA.report.summary.totalSalesUgx).toBe(500_000);

    const openB = buildCashPositionDashboard(cashPositionInput(all, [close], DAY_B));
    expect(openB.report.summary.totalSalesUgx).toBe(80_000);
  });

  it("keeps an open day on live calculations", () => {
    const openSale = sale("s-open", 80_000, `${DAY_B}T10:00:00.000Z`);
    const daily = localGetDailySalesSummary([openSale], [product], [], DAY_B, [close]);
    expect(daily.totalRevenueUgx).toBe(80_000);
    const dash = buildCashPositionDashboard(cashPositionInput([openSale], [close], DAY_B));
    expect(dash.report.summary.totalSalesUgx).toBe(80_000);
    expect(dash.drawerStatus?.countedCashUgx ?? null).toBeNull();
  });
});

describe("CLOSE-DAY-1.1 Kampala date boundary", () => {
  it("assigns 23:59 / 00:00 / 00:01 Kampala to the correct business day", () => {
    expect(dateKeyKampala("2026-08-12T20:59:00.000Z")).toBe("2026-08-12");
    expect(dateKeyKampala("2026-08-12T21:00:00.000Z")).toBe("2026-08-13");
    expect(dateKeyKampala("2026-08-12T21:01:00.000Z")).toBe("2026-08-13");

    const before = sale("s-2359", 500_000, "2026-08-12T20:59:00.000Z");
    const midnight = sale("s-0000", 30_000, "2026-08-12T21:00:00.000Z");
    const after = sale("s-0001", 10_000, "2026-08-12T21:01:00.000Z");
    const close = closeFor({
      id: "c-bound",
      dateKey: "2026-08-12",
      salesUgx: 500_000,
      expectedCashUgx: 500_000,
      countedCashUgx: 500_000,
      profitUgx: 400_000,
      txn: 1,
      createdAt: "2026-08-12T20:50:00.000Z",
    });
    const dailyA = localGetDailySalesSummary([before, midnight, after], [product], [], "2026-08-12", [close]);
    expect(dailyA.totalRevenueUgx).toBe(500_000);
    const dailyB = localGetDailySalesSummary([before, midnight, after], [product], [], "2026-08-13");
    expect(dailyB.totalRevenueUgx).toBe(40_000);
  });
});

describe("CLOSE-DAY-1.1 sync must not overwrite frozen close", () => {
  it("keeps local documentSnapshot when a newer pull omits it", () => {
    const local = closeFor({
      id: "dc-1",
      dateKey: DAY_A,
      salesUgx: 500_000,
      expectedCashUgx: 500_000,
      countedCashUgx: 490_000,
      profitUgx: 400_000,
      txn: 1,
      createdAt: `${DAY_A}T18:00:00.000Z`,
    });
    const remote: DayCloseSummary = {
      ...local,
      documentSnapshot: null,
      totalSalesUgx: 530_000,
      expectedCashUgx: 530_000,
      updatedAt: `${DAY_A}T19:00:00.000Z`,
    };
    const merged = preserveFrozenCloseFields(local, remote);
    expect(merged.documentSnapshot).toBeTruthy();
    expect(merged.totalSalesUgx).toBe(500_000);
    expect(merged.expectedCashUgx).toBe(500_000);
    expect(merged.documentSnapshot?.totalSalesUgx).toBe(500_000);
  });

  it("collapse after pull leaves one active close and preserves the snapshot", () => {
    const local = closeFor({
      id: "dc-1",
      dateKey: DAY_A,
      salesUgx: 500_000,
      expectedCashUgx: 500_000,
      countedCashUgx: 500_000,
      profitUgx: 400_000,
      txn: 1,
      createdAt: `${DAY_A}T18:00:00.000Z`,
    });
    const cloudExtra: DayCloseSummary = {
      id: "dc-2",
      dateKey: DAY_A,
      expectedCashUgx: 1,
      countedCashUgx: 1,
      differenceUgx: 0,
      totalSalesUgx: 1,
      totalDebtUgx: 0,
      profitEstimateUgx: 1,
      createdAt: `${DAY_A}T17:00:00.000Z`,
      pendingSync: false,
    };
    const merged = mergeDayClosesFromCloudPull([local], [cloudExtra]);
    const active = merged.filter((d) => !d.supersededAt);
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe("dc-1");
    expect(active[0]?.documentSnapshot).toBeTruthy();
    expect(merged).toHaveLength(2);
  });

  it("same-id merge does not wipe snapshot totals", () => {
    const local = closeFor({
      id: "dc-1",
      dateKey: DAY_A,
      salesUgx: 500_000,
      expectedCashUgx: 500_000,
      countedCashUgx: 500_000,
      profitUgx: 400_000,
      txn: 1,
      createdAt: `${DAY_A}T18:00:00.000Z`,
    });
    const remote: DayCloseSummary = {
      id: "dc-1",
      dateKey: DAY_A,
      expectedCashUgx: 0,
      countedCashUgx: 0,
      differenceUgx: 0,
      totalSalesUgx: 0,
      totalDebtUgx: 0,
      profitEstimateUgx: 0,
      createdAt: `${DAY_A}T18:00:00.000Z`,
      updatedAt: `${DAY_A}T20:00:00.000Z`,
      pendingSync: false,
    };
    const merged = mergeDayClosePair(local, remote);
    expect(merged.documentSnapshot?.totalSalesUgx).toBe(500_000);
    expect(merged.totalSalesUgx).toBe(500_000);
  });
});

describe("CLOSE-DAY-1.1 period overlay", () => {
  it("replaces a closed day inside a range without touching an open day", () => {
    const a = sale("s-a", 500_000, `${DAY_A}T10:00:00.000Z`);
    const late = sale("s-late", 30_000, `${DAY_A}T16:00:00.000Z`);
    const b = sale("s-b", 80_000, `${DAY_B}T10:00:00.000Z`);
    const close = closeFor({
      id: "close-a",
      dateKey: DAY_A,
      salesUgx: 500_000,
      expectedCashUgx: 500_000,
      countedCashUgx: 500_000,
      profitUgx: 400_000,
      txn: 1,
      createdAt: `${DAY_A}T18:00:00.000Z`,
    });
    const live = getCompletedFinancials([a, late, b], [], [product], {});
    const overlaid = overlayPeriodFinancials({
      live: {
        revenueUgx: live.revenueUgx,
        profitUgx: live.profitUgx,
        transactionCount: live.transactionCount,
        debtIssuedUgx: live.debtIssuedUgx,
      },
      dayCloses: [close],
      bounds: { fromKey: DAY_A, toKey: DAY_B, isSingleDay: false },
      sales: [a, late, b],
      returns: [],
      products: [product],
    });
    expect(overlaid.revenueUgx).toBe(580_000);
    expect(overlaid.transactionCount).toBe(2);
  });
});
