import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DayCloseSummary, Sale } from "../types";
import { periodSalesBreakdownsUnavailable, resolvePeriodReportAuthority } from "./closedDayAuthority";
import {
  buildKpiCards,
  computeDailyRevenueSparkline,
  presentCommandCenterExpectedCash,
  presentCommandCenterSparkline,
  type SparkPoint,
} from "./commandCenterPageView";
import { resolveDateFilterBounds } from "./dateFilters";
import { dateKeyKampala } from "./datesUg";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import type { OwnerFinancialExtended } from "./ownerCommandCenterBuilders";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const ROLLING: SparkPoint[] = [
  { value: 1 },
  { value: 2 },
  { value: 3 },
  { value: 4 },
  { value: 5 },
  { value: 6 },
  { value: 7 },
];

const NOW = "2026-09-06T09:00:00.000Z";

function present(
  filter: Parameters<typeof resolveDateFilterBounds>[0],
  extras: Partial<Parameters<typeof presentCommandCenterSparkline>[1]> = {},
) {
  return presentCommandCenterSparkline(ROLLING, {
    bounds: resolveDateFilterBounds(filter),
    authority: extras.authority ?? "live",
    dataComplete: extras.dataComplete ?? true,
  });
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "createdAt" | "totalUgx">): Sale {
  return {
    updatedAt: partial.createdAt,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.totalUgx,
    debtUgx: 0,
    paymentMethod: "cash",
    estimatedProfitUgx: 0,
    lines: [],
    pendingSync: false,
    lastSyncError: null,
    status: "completed",
    ...partial,
  };
}

function closeFor(dateKey: string, expectedCashUgx: number): DayCloseSummary {
  const row = {
    id: `close-${dateKey}`,
    dateKey,
    expectedCashUgx,
    countedCashUgx: expectedCashUgx,
    differenceUgx: 0,
    totalSalesUgx: 100_000,
    totalDebtUgx: 0,
    profitEstimateUgx: 40_000,
    openingFloatUgx: 0,
    createdAt: `${dateKey}T18:00:00.000Z`,
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
        cashFromSalesUgx: 30_000,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 0,
        openingFloatUgx: 0,
        cashSalesUgx: 30_000,
        supplierPaymentsUgx: 0,
        adjustmentInflowsUgx: 0,
        adjustmentOutflowsUgx: 0,
        cashRefundsUgx: 0,
      },
      transactionCount: 1,
    }),
    supersededAt: null,
    pendingSync: false,
    updatedAt: `${dateKey}T18:00:00.000Z`,
  };
}

const emptyFinancial: OwnerFinancialExtended = {
  revenueUgx: 8_000_000,
  profitUgx: 0,
  transactionCount: 0,
  costIncomplete: false,
  debtCollectedUgx: 0,
  receivablesUgx: 0,
  payablesUgx: 0,
  expensesTodayUgx: 0,
  expensesPeriodUgx: 0,
  expensesPriorPeriodUgx: 0,
  purchasesUgx: 0,
  debtIssuedUgx: 0,
  topSuppliers: [],
  paymentMix: {
    cashUgx: 0,
    mobileMoneyUgx: 0,
    atmUgx: 0,
    creditUgx: 0,
    mixedUgx: 0,
    otherUgx: 0,
  },
  trendVsPriorDay: null,
  trendVsPriorWeek: null,
  trendVsPriorMonth: null,
};

describe("CC-P2-04 Owner Command Center sparkline period authority", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TEST 1 — Today keeps the existing rolling live sparkline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    expect(dateKeyKampala(new Date())).toBe("2026-09-06");
    const raw = computeDailyRevenueSparkline([
      sale({ id: "sep6", createdAt: "2026-09-06T08:00:00.000Z", totalUgx: 50_000 }),
      sale({ id: "sep5", createdAt: "2026-09-05T08:00:00.000Z", totalUgx: 20_000 }),
    ]);
    expect(raw).toHaveLength(7);
    expect(raw[6]?.value).toBe(50_000);
    expect(raw[5]?.value).toBe(20_000);
    const presented = present({ kind: "preset", preset: "today" });
    expect(presented).toBe(ROLLING);
    expect(presented).toHaveLength(7);
  });

  it("TEST 2 — Yesterday does not render today's rolling 7-day series", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const presented = present({ kind: "preset", preset: "yesterday" });
    expect(presented).toEqual([]);
    expect(presented).not.toBe(ROLLING);
  });

  it("TEST 3 — Historical April month never contains September rolling values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const presented = present({ kind: "range", fromKey: "2026-04-01", toKey: "2026-04-30" });
    expect(presented).toEqual([]);
    expect(presented.some((p) => p.value === 7)).toBe(false);
  });

  it("TEST 4 — Custom historical April 1–10 hides the live series", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const presented = present({ kind: "range", fromKey: "2026-04-01", toKey: "2026-04-10" });
    expect(presented).toEqual([]);
  });

  it("TEST 5 — This month does not reuse the current rolling 7-day series", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const presented = present({ kind: "preset", preset: "this_month" });
    expect(presented).toEqual([]);
  });

  it("TEST 6 — Closed day can keep a frozen headline but hides the sparkline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const day = "2026-04-10";
    const bounds = resolveDateFilterBounds({ kind: "day", dateKey: day });
    const closed = closeFor(day, 95_000);
    const authority = resolvePeriodReportAuthority([closed], bounds);
    expect(periodSalesBreakdownsUnavailable(authority)).toBe(true);
    expect(presentCommandCenterExpectedCash(bounds, [closed], 150_000)).toBe(95_000);
    const presented = presentCommandCenterSparkline(ROLLING, {
      bounds,
      authority,
      dataComplete: true,
    });
    expect(presented).toEqual([]);
  });

  it("TEST 7 — Mixed period hides the sparkline; no partial live chart", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const presented = present(
      { kind: "range", fromKey: "2026-09-01", toKey: "2026-09-06" },
      { authority: "mixed" },
    );
    expect(periodSalesBreakdownsUnavailable("mixed")).toBe(true);
    expect(presented).toEqual([]);
  });

  it("TEST 8 — Sale + later return range hides rather than plotting gross-only history", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const presented = present({ kind: "range", fromKey: "2026-09-04", toKey: "2026-09-05" });
    expect(presented).toEqual([]);
  });

  it("TEST 9 — Voided / cancelled sales do not appear as a historical trend", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const cancelled = sale({
      id: "voided",
      createdAt: "2026-09-06T08:00:00.000Z",
      totalUgx: 80_000,
      status: "cancelled",
    });
    const raw = computeDailyRevenueSparkline([cancelled]);
    expect(raw.every((p) => p.value === 0)).toBe(true);
    const presented = present({ kind: "day", dateKey: "2026-04-10" });
    expect(presented).toEqual([]);
  });

  it("TEST 10 — All Time does not emit an enormous daily series", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const presented = present({ kind: "range", fromKey: "2020-01-01", toKey: "2026-09-06" });
    expect(presented).toEqual([]);
    expect(presented.length).toBeLessThan(2);
  });

  it("TEST 11 — Customer and other KPI cards share the gated series, not a separate live chart", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const hidden = present({ kind: "preset", preset: "yesterday" });
    const cards = buildKpiCards(emptyFinancial, 95_000, 4, hidden);
    expect(cards.every((card) => card.sparkline.length === 0)).toBe(true);
    expect(cards.some((card) => card.id === "customers")).toBe(true);
    expect(cards.some((card) => card.id === "expected-cash")).toBe(true);
  });

  it("incomplete hydration never falls back to live RAM sparkline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const presented = present({ kind: "preset", preset: "today" }, { dataComplete: false });
    expect(presented).toEqual([]);
  });
});

describe("CC-P2-04 source wiring", () => {
  it("TEST 12 — Command Center presents the sparkline; other P2 helpers stay in place", () => {
    const page = src("src/pages/OwnerDashboardPage.tsx");
    expect(page).toContain("presentCommandCenterSparkline");
    expect(page).toContain("computeDailyRevenueSparkline(sales)");
    expect(page).toContain("presentCommandCenterExpectedCash");
    expect(page).toContain("presentCommandCenterOfficialFinancials");
    expect(page).toContain("resolveProfitVisibility");
    expect(page).toContain("resolveReportsFinancialReadiness");

    const helper = src("src/lib/commandCenterPageView.ts");
    expect(helper).toContain("periodSalesBreakdownsUnavailable");
    expect(helper).toContain("presentCommandCenterSparkline");
    expect(helper).not.toContain("toISOString().slice(0, 10)");

    const liveOps = src("src/lib/ownerDashboardCommandCenter.ts");
    expect(liveOps).toContain("primaryDayKey: dateKeyKampala(new Date())");
    expect(liveOps).toContain("primaryDayKey: input.bounds.toKey");

    const intelligence = src("src/lib/ownerCommandCenterBuilders.ts");
    expect(intelligence).toContain("presentCommandCenterPeriodFinancialIntelligence");

    const reportsSpark = src("src/features/business-analytics/lib/reportsKpiSparklineContext.ts");
    expect(reportsSpark).not.toContain("presentCommandCenterSparkline");
  });
});
