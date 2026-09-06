import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DayCloseSummary } from "../types";
import { buildCommandCenterExportRows } from "./analyticsReportExport";
import { dayClosesForAuthority } from "./closedDayAuthority";
import {
  buildCommandCenterExportText,
  buildKpiCards,
  presentCommandCenterExpectedCash,
} from "./commandCenterPageView";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import type { OwnerFinancialExtended } from "./ownerCommandCenterBuilders";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const DAY_A = "2026-04-10";
const DAY_B = "2026-08-12";

function bounds(fromKey: string, toKey = fromKey) {
  return { fromKey, toKey, isSingleDay: fromKey === toKey };
}

function closeFor(params: {
  id: string;
  dateKey: string;
  expectedCashUgx: number;
  supersededAt?: string | null;
}): DayCloseSummary {
  const row = {
    id: params.id,
    dateKey: params.dateKey,
    expectedCashUgx: params.expectedCashUgx,
    countedCashUgx: params.expectedCashUgx,
    differenceUgx: 0,
    totalSalesUgx: 100_000,
    totalDebtUgx: 0,
    profitEstimateUgx: 40_000,
    openingFloatUgx: 0,
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
    supersededAt: params.supersededAt ?? null,
    pendingSync: false,
    updatedAt: `${params.dateKey}T18:00:00.000Z`,
  };
}

const emptyFinancial: OwnerFinancialExtended = {
  revenueUgx: 0,
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

describe("CC-P2-01 Command Center selected-day Expected Cash authority", () => {
  it("TEST 1 — open day keeps live expected cash", () => {
    const shown = presentCommandCenterExpectedCash(bounds(DAY_B), [], 120_000);
    expect(shown).toBe(120_000);
  });

  it("TEST 2 — active closed day uses frozen expected cash, not live rebuild", () => {
    const active = closeFor({ id: "active-b", dateKey: DAY_B, expectedCashUgx: 95_000 });
    const shown = presentCommandCenterExpectedCash(bounds(DAY_B), [active], 120_000);
    expect(shown).toBe(95_000);
    expect(shown).not.toBe(120_000);
  });

  it("TEST 3 — archived-only closed day uses archived frozen expected cash", () => {
    const archived = closeFor({ id: "arch-a", dateKey: DAY_A, expectedCashUgx: 80_000 });
    const merged = dayClosesForAuthority([], [archived]);
    const shown = presentCommandCenterExpectedCash(bounds(DAY_A), merged, 150_000);
    expect(shown).toBe(80_000);
    expect(shown).not.toBe(150_000);
  });

  it("TEST 4 — mixed / multi-day range stays unavailable", () => {
    const archived = closeFor({ id: "arch-a", dateKey: DAY_A, expectedCashUgx: 80_000 });
    const merged = dayClosesForAuthority([], [archived]);
    const shown = presentCommandCenterExpectedCash(bounds(DAY_A, DAY_B), merged, 120_000);
    expect(shown).toBeNull();
  });

  it("TEST 5 — screen KPI and export use the same closed-day value", () => {
    const active = closeFor({ id: "active-b", dateKey: DAY_B, expectedCashUgx: 95_000 });
    const shown = presentCommandCenterExpectedCash(bounds(DAY_B), [active], 120_000);
    const cards = buildKpiCards(emptyFinancial, shown, 0, []);
    const rows = buildCommandCenterExportRows({
      lang: "en",
      shopName: "Waka",
      periodLabel: DAY_B,
      score: 80,
      revenueUgx: 0,
      profitUgx: 0,
      transactions: 0,
      expectedCashUgx: shown,
    });
    const text = buildCommandCenterExportText({
      shopName: "Waka",
      periodLabel: DAY_B,
      score: 80,
      revenueUgx: 0,
      profitUgx: 0,
      transactions: 0,
      expectedCashUgx: shown,
    });
    expect(cards.find((c) => c.id === "expected-cash")?.value).not.toBe("—");
    expect(rows.some((row) => row[1] === 95_000)).toBe(true);
    expect(rows.flat().join(" ")).not.toContain("120000");
    expect(text).toContain("UGX 95,000");
    expect(text).not.toContain("UGX 120,000");
  });

  it("TEST 6 — mixed tender does not reconstruct expected cash from sale totals", () => {
    const closed = closeFor({ id: "mix-a", dateKey: DAY_A, expectedCashUgx: 95_000 });
    const shown = presentCommandCenterExpectedCash(bounds(DAY_A), [closed], 100_000);
    expect(shown).toBe(95_000);
    expect(shown).not.toBe(100_000);
    expect(shown).not.toBe(50_000);
    expect(shown).not.toBe(30_000);
  });

  it("TEST 7 — active close wins over archived for the same date", () => {
    const active = closeFor({ id: "active-a", dateKey: DAY_A, expectedCashUgx: 95_000 });
    const archived = closeFor({ id: "arch-a", dateKey: DAY_A, expectedCashUgx: 80_000 });
    const merged = dayClosesForAuthority([active], [archived]);
    expect(presentCommandCenterExpectedCash(bounds(DAY_A), merged, 150_000)).toBe(95_000);
  });

  it("TEST 8 — no snapshot keeps the existing live fallback", () => {
    const shown = presentCommandCenterExpectedCash(bounds(DAY_A), [], 120_000);
    expect(shown).toBe(120_000);
  });

  it("superseded close does not freeze expected cash", () => {
    const superseded = closeFor({
      id: "super-a",
      dateKey: DAY_A,
      expectedCashUgx: 80_000,
      supersededAt: `${DAY_A}T19:00:00.000Z`,
    });
    expect(presentCommandCenterExpectedCash(bounds(DAY_A), [superseded], 120_000)).toBe(120_000);
  });
});

describe("CC-P2-01 source wiring", () => {
  it("Owner Command Center presents Expected Cash through the authority helper", () => {
    const page = src("src/pages/OwnerDashboardPage.tsx");
    expect(page).toContain("presentCommandCenterExpectedCash");
    expect(page).toContain("useDayClosesForAuthority");
    expect(page).toContain("useExpectedDrawerCashForBounds");

    const helper = src("src/lib/commandCenterPageView.ts");
    expect(helper).toContain("resolveReportAuthority");
    expect(helper).toContain("frozenTotals?.expectedCashUgx");
    expect(helper).not.toContain("[...s.dayCloses");
  });
});
