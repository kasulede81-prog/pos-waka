import { afterEach, describe, expect, it, vi } from "vitest";
import type { DayCloseSummary, Product, ReturnRecord, Sale } from "../types";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { addDaysToDateKey, enumerateDaysInBounds, resolveDateFilterBounds } from "./dateFilters";
import { getCompletedFinancials } from "./financialMetrics";
import {
  aggregateReportsTrendPoints,
  localGetRangeSummary,
  REPORTS_TREND_DAILY_MAX_DAYS,
  REPORTS_TREND_WEEKLY_MAX_DAYS,
} from "./localReporting";
import { weekStartKeyKampala } from "./datesUg";

const product: Product = {
  id: "p1",
  name: "Item",
  sellingPricePerUnitUgx: 10_000,
  costPricePerUnitUgx: 4_000,
  stockOnHand: 80,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T08:00:00.000Z",
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
    estimatedProfitUgx: totalUgx - 4_000,
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: totalUgx,
        unitCostUgx: 4_000,
        lineTotalUgx: totalUgx,
        estimatedProfitUgx: totalUgx - 4_000,
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

function ret(id: string, saleId: string, refundAmountUgx: number, createdAt: string): ReturnRecord {
  return {
    id,
    saleId,
    productId: "p1",
    productName: "Item",
    quantity: 1,
    reason: "wrong_item",
    actorUserId: "owner",
    actorName: "Owner",
    shiftId: null,
    createdAt,
    refundAmountUgx,
    cogsUgx: Math.round((4_000 * refundAmountUgx) / 10_000),
  };
}

function closeFor(dateKey: string, salesUgx: number, txn: number): DayCloseSummary {
  const createdAt = `${dateKey}T18:00:00.000Z`;
  const row = {
    id: `close-${dateKey}`,
    dateKey,
    expectedCashUgx: salesUgx,
    countedCashUgx: salesUgx,
    differenceUgx: 0,
    totalSalesUgx: salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: salesUgx - 4_000,
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
        cashFromSalesUgx: salesUgx,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 0,
        openingFloatUgx: 0,
        cashSalesUgx: salesUgx,
        supplierPaymentsUgx: 0,
        adjustmentInflowsUgx: 0,
        adjustmentOutflowsUgx: 0,
        cashRefundsUgx: 0,
      },
      transactionCount: txn,
    }),
    supersededAt: null,
    pendingSync: false,
    updatedAt: createdAt,
  };
}

function rangeSummary(
  sales: Sale[],
  filter: Parameters<typeof localGetRangeSummary>[5],
  returns: ReturnRecord[] = [],
  dayCloses?: DayCloseSummary[],
) {
  return localGetRangeSummary(sales, [product], [], returns, [], filter, [], dayCloses);
}

describe("RPT-P3-02 reports trend granularity", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TEST 1 — last 7 days produces 7 daily points that sum to range revenue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));
    const filter = { kind: "range" as const, fromKey: addDaysToDateKey("2026-06-12", -6), toKey: "2026-06-12" };
    const bounds = resolveDateFilterBounds(filter);
    expect(enumerateDaysInBounds(bounds)).toHaveLength(7);

    const sales = [
      sale("s-start", 10_000, `${bounds.fromKey}T10:00:00.000Z`),
      sale("s-mid", 20_000, "2026-06-09T10:00:00.000Z"),
      sale("s-end", 30_000, `${bounds.toKey}T10:00:00.000Z`),
    ];
    const result = rangeSummary(sales, filter);

    expect(result.dailyTrend).toHaveLength(7);
    expect(result.dailyTrend.map((p) => p.day)).toEqual(enumerateDaysInBounds(bounds));
    expect(result.dailyTrend[0]?.day).toBe(bounds.fromKey);
    expect(result.dailyTrend[6]?.day).toBe(bounds.toKey);
    expect(result.dailyTrend.reduce((a, p) => a + p.revenueUgx, 0)).toBe(60_000);
    expect(result.summary.totalRevenueUgx).toBe(60_000);
  });

  it("TEST 2 — custom 3 days produces exactly 3 daily points", () => {
    const filter = { kind: "range" as const, fromKey: "2026-06-10", toKey: "2026-06-12" };
    const sales = [
      sale("a", 5_000, "2026-06-10T10:00:00.000Z"),
      sale("b", 7_000, "2026-06-12T10:00:00.000Z"),
    ];
    const result = rangeSummary(sales, filter);
    expect(result.dailyTrend).toHaveLength(3);
    expect(result.dailyTrend.map((p) => p.day)).toEqual(["2026-06-10", "2026-06-11", "2026-06-12"]);
    expect(result.dailyTrend[1]?.revenueUgx).toBe(0);
    expect(result.dailyTrend.reduce((a, p) => a + p.revenueUgx, 0)).toBe(12_000);
  });

  it("TEST 3 — last month (February 2026, 28 days) is one point per calendar day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T12:00:00.000Z"));
    const filter = { kind: "range" as const, fromKey: "2026-02-01", toKey: "2026-02-28" };
    const bounds = resolveDateFilterBounds(filter);
    expect(bounds.fromKey).toBe("2026-02-01");
    expect(bounds.toKey).toBe("2026-02-28");

    const sales = [
      sale("feb1", 8_000, "2026-02-01T10:00:00.000Z"),
      sale("feb28", 12_000, "2026-02-28T10:00:00.000Z"),
    ];
    const result = rangeSummary(sales, filter);
    const days = enumerateDaysInBounds(bounds);
    expect(days).toHaveLength(28);
    expect(result.dailyTrend).toHaveLength(28);
    expect(result.dailyTrend.map((p) => p.day)).toEqual(days);
    expect(result.dailyTrend[0]?.revenueUgx).toBe(8_000);
    expect(result.dailyTrend[27]?.revenueUgx).toBe(12_000);
  });

  it("TEST 4 — custom 30 days produces daily points", () => {
    const filter = { kind: "range" as const, fromKey: "2026-06-01", toKey: "2026-06-30" };
    const sales = [sale("mid", 15_000, "2026-06-15T10:00:00.000Z")];
    const result = rangeSummary(sales, filter);
    expect(result.dailyTrend).toHaveLength(30);
    expect(result.dailyTrend[14]?.day).toBe("2026-06-15");
    expect(result.dailyTrend[14]?.revenueUgx).toBe(15_000);
  });

  it("TEST 5 — range longer than the daily cap aggregates weekly, not one bar", () => {
    const fromKey = "2026-01-01";
    const toKey = addDaysToDateKey(fromKey, REPORTS_TREND_DAILY_MAX_DAYS);
    const filter = { kind: "range" as const, fromKey, toKey };
    const dayCount = enumerateDaysInBounds(resolveDateFilterBounds(filter)).length;
    expect(dayCount).toBe(REPORTS_TREND_DAILY_MAX_DAYS + 1);
    expect(dayCount).toBeLessThanOrEqual(REPORTS_TREND_WEEKLY_MAX_DAYS);

    const sales = [
      sale("a", 10_000, "2026-01-01T10:00:00.000Z"),
      sale("b", 20_000, `${toKey}T10:00:00.000Z`),
    ];
    const result = rangeSummary(sales, filter);
    expect(result.dailyTrend.length).toBeGreaterThan(1);
    expect(result.dailyTrend.length).toBeLessThan(dayCount);
    for (const point of result.dailyTrend) {
      expect(weekStartKeyKampala(point.day)).toBe(point.day);
    }
    expect(result.dailyTrend.reduce((a, p) => a + p.revenueUgx, 0)).toBe(30_000);
  });

  it("TEST 6 — this year produces monthly buckets and never one bar", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    const filter = { kind: "range" as const, fromKey: "2026-01-01", toKey: "2026-09-05" };
    const dayCount = enumerateDaysInBounds(resolveDateFilterBounds(filter)).length;
    expect(dayCount).toBeGreaterThan(REPORTS_TREND_WEEKLY_MAX_DAYS);

    const sales = [
      sale("jan", 10_000, "2026-01-15T10:00:00.000Z"),
      sale("sep", 25_000, "2026-09-05T10:00:00.000Z"),
    ];
    const result = rangeSummary(sales, filter);
    expect(result.dailyTrend.length).toBeGreaterThan(1);
    expect(result.dailyTrend).toHaveLength(9);
    expect(result.dailyTrend.map((p) => p.day)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);
    expect(result.dailyTrend.reduce((a, p) => a + p.revenueUgx, 0)).toBe(35_000);
  });

  it("TEST 7 — closed day uses frozen trend authority, not live post-close sales", () => {
    const closed = "2026-08-12";
    const open = "2026-08-13";
    const liveClosedSale = sale("live", 200_000, `${closed}T10:00:00.000Z`);
    const lateSale = sale("late", 50_000, `${closed}T20:00:00.000Z`);
    const openSale = sale("open", 30_000, `${open}T10:00:00.000Z`);
    const closes = [closeFor(closed, 100_000, 1)];

    const result = rangeSummary([liveClosedSale, lateSale, openSale], { kind: "range", fromKey: closed, toKey: open }, [], closes);
    expect(result.dailyTrend).toHaveLength(2);
    expect(result.dailyTrend[0]?.day).toBe(closed);
    expect(result.dailyTrend[0]?.revenueUgx).toBe(100_000);
    expect(result.dailyTrend[0]?.revenueUgx).not.toBe(250_000);
    expect(result.dailyTrend[1]?.revenueUgx).toBe(30_000);
  });

  it("TEST 8 — returned sale uses the same per-day completed financials as this_month", () => {
    const day = "2026-06-10";
    const original = sale("s-ret", 10_000, `${day}T10:00:00.000Z`);
    const returns = [ret("r1", "s-ret", 10_000, `${day}T14:00:00.000Z`)];
    const expected = getCompletedFinancials([original], returns, [product], { day });

    const result = rangeSummary([original], { kind: "range", fromKey: "2026-06-10", toKey: "2026-06-12" }, returns);
    const point = result.dailyTrend.find((p) => p.day === day);
    expect(point?.revenueUgx).toBe(expected.revenueUgx);
    expect(point?.transactionCount).toBe(expected.transactionCount);
  });

  it("TEST 9 — available range: trend buckets sum to range financial total", () => {
    const filter = { kind: "range" as const, fromKey: "2026-06-01", toKey: "2026-06-07" };
    const sales = [
      sale("d1", 10_000, "2026-06-01T10:00:00.000Z"),
      sale("d3", 20_000, "2026-06-03T10:00:00.000Z"),
      sale("d7", 40_000, "2026-06-07T10:00:00.000Z"),
    ];
    const result = rangeSummary(sales, filter);
    const trendSum = result.dailyTrend.reduce((a, p) => a + p.revenueUgx, 0);
    expect(trendSum).toBe(result.summary.totalRevenueUgx);
    expect(trendSum).toBe(70_000);
  });

  it("this_week and this_month stay daily", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));
    const week = rangeSummary([], { kind: "preset", preset: "this_week" });
    expect(week.dailyTrend.map((p) => p.day)).toEqual(["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12"]);

    const month = rangeSummary([sale("m", 9_000, "2026-06-03T10:00:00.000Z")], { kind: "preset", preset: "this_month" });
    expect(month.dailyTrend).toHaveLength(12);
    expect(month.dailyTrend.find((p) => p.day === "2026-06-03")?.revenueUgx).toBe(9_000);
  });

  it("today remains a single point", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));
    const result = rangeSummary([sale("t", 11_000, "2026-06-12T10:00:00.000Z")], { kind: "preset", preset: "today" });
    expect(result.dailyTrend).toHaveLength(1);
    expect(result.dailyTrend[0]?.day).toBe("2026-06-12");
    expect(result.dailyTrend[0]?.revenueUgx).toBe(11_000);
  });

  it("aggregateReportsTrendPoints is a fold of day points (no second sales scan)", () => {
    const daily = [
      { day: "2026-01-01", revenueUgx: 100, transactionCount: 1 },
      { day: "2026-01-02", revenueUgx: 50, transactionCount: 1 },
      { day: "2026-01-03", revenueUgx: 0, transactionCount: 0 },
    ];
    expect(aggregateReportsTrendPoints(daily)).toEqual(daily);
  });
});
