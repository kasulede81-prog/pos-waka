import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commandCenterComparisonLabelKey, pctChangeLabel, presentCommandCenterExpectedCash } from "./commandCenterPageView";
import { addDaysToDateKey, resolveDateFilterBounds } from "./dateFilters";
import { dateKeyKampala } from "./datesUg";
import { t } from "./i18n";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import type { DayCloseSummary } from "../types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const NOW = "2026-09-06T09:00:00.000Z";

function labelFor(filter: Parameters<typeof resolveDateFilterBounds>[0]) {
  const bounds = resolveDateFilterBounds(filter);
  const key = commandCenterComparisonLabelKey(bounds);
  return {
    bounds,
    priorDayKey: addDaysToDateKey(bounds.fromKey, -1),
    key,
    en: t("en", key),
    lg: t("lg", key),
  };
}

function hint(pct: number | null, key: string, lang: "en" | "lg" = "en") {
  const pctLabel = pctChangeLabel(pct);
  return pctLabel ? `${pctLabel} ${t(lang, key)}` : undefined;
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

describe("CC-P2-05 Owner Command Center comparison label authority", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TEST 1 — Today labels the prior day as vs yesterday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const shown = labelFor({ kind: "preset", preset: "today" });
    expect(shown.bounds.toKey).toBe("2026-09-06");
    expect(shown.priorDayKey).toBe("2026-09-05");
    expect(shown.key).toBe("cmdCenterVsYesterday");
    expect(shown.en).toBe("vs yesterday");
  });

  it("TEST 2 — Yesterday labels the preceding business day as vs previous day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const shown = labelFor({ kind: "preset", preset: "yesterday" });
    expect(shown.bounds.toKey).toBe("2026-09-05");
    expect(shown.priorDayKey).toBe("2026-09-04");
    expect(shown.key).toBe("cmdCenterVsPreviousDay");
    expect(shown.en).toBe("vs previous day");
    expect(shown.en).not.toBe("vs yesterday");
  });

  it("TEST 3 — This week comparison window is the day before week start, not yesterday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const shown = labelFor({ kind: "preset", preset: "this_week" });
    expect(shown.bounds.fromKey).toBe("2026-08-31");
    expect(shown.priorDayKey).toBe("2026-08-30");
    expect(shown.en).toBe("vs previous day");
    expect(shown.en).not.toBe("vs yesterday");
    expect(shown.en).not.toBe("vs previous week");
  });

  it("TEST 4 — This month comparison window is the day before month start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const shown = labelFor({ kind: "preset", preset: "this_month" });
    expect(shown.bounds.fromKey).toBe("2026-09-01");
    expect(shown.priorDayKey).toBe("2026-08-31");
    expect(shown.en).toBe("vs previous day");
    expect(shown.en).not.toBe("vs previous month");
    expect(shown.en).not.toBe("vs yesterday");
  });

  it("TEST 5 — Custom April 1–10 labels the actual prior day, not yesterday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const shown = labelFor({ kind: "range", fromKey: "2026-04-01", toKey: "2026-04-10" });
    expect(shown.priorDayKey).toBe("2026-03-31");
    expect(shown.en).toBe("vs previous day");
    expect(shown.en).not.toBe("vs yesterday");
  });

  it("TEST 6 — All Time only labels the real prior day when a percentage exists", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const shown = labelFor({ kind: "range", fromKey: "2020-01-01", toKey: "2026-09-06" });
    expect(shown.priorDayKey).toBe("2019-12-31");
    expect(shown.en).toBe("vs previous day");
    expect(hint(100, shown.key)).toBe("↑ 100% vs previous day");
    expect(hint(null, shown.key)).toBeUndefined();
  });

  it("TEST 7 — Zero / missing previous comparison does not invent vs yesterday wording", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const shown = labelFor({ kind: "preset", preset: "this_month" });
    expect(hint(null, shown.key)).toBeUndefined();
    expect(hint(null, "cmdCenterVsYesterday")).toBeUndefined();
    expect(pctChangeLabel(null)).toBeNull();
    expect(pctChangeLabel(12)).toBe("↑ 12%");
    expect(pctChangeLabel(-8)).toBe("↓ 8%");
  });

  it("TEST 8 — Empty current period still uses the existing percentage formatter", () => {
    expect(pctChangeLabel(0)).toBe("↑ 0%");
    expect(pctChangeLabel(null)).toBeNull();
  });

  it("TEST 9 — Archived closed Expected Cash is unchanged; only the label key changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const bounds = resolveDateFilterBounds({ kind: "day", dateKey: "2026-04-10" });
    const archived = closeFor("2026-04-10", 95_000);
    expect(presentCommandCenterExpectedCash(bounds, [archived], 150_000)).toBe(95_000);
    expect(commandCenterComparisonLabelKey(bounds)).toBe("cmdCenterVsPreviousDay");
  });

  it("TEST 10 — Mixed / multi-day range does not change comparison math source", () => {
    const builders = src("src/lib/ownerCommandCenterBuilders.ts");
    expect(builders).toContain("const priorToKey = addDaysToDateKey(input.bounds.fromKey, -1);");
    expect(builders).toContain("trendVsPriorDay: trendComparison(current, priorDay),");
    expect(builders).toContain("trendVsPriorWeek: trendComparison(current, priorWeek),");
    expect(builders).toContain("trendVsPriorMonth: trendComparison(current, priorMonth),");
    const kpi = src("src/lib/commandCenterPageView.ts");
    expect(kpi).toContain("financial.trendVsPriorDay?.pctRevenue");
    expect(kpi).toContain("financial.trendVsPriorDay?.pctProfit");
  });

  it("TEST 11 — English and Luganda use existing i18n conventions", () => {
    expect(t("en", "cmdCenterVsYesterday")).toBe("vs yesterday");
    expect(t("en", "cmdCenterVsPreviousDay")).toBe("vs previous day");
    expect(t("lg", "cmdCenterVsYesterday")).toBe("okugerageranya na jjo");
    expect(t("lg", "cmdCenterVsPreviousDay")).toBe("okugerageranya n'olunaku olwayita");
    expect(t("lg", "cmdCenterVsPreviousDay")).not.toBe("okugerageranya na jjo");
  });
});

describe("CC-P2-05 source wiring", () => {
  it("TEST 12 — KPI and financial grids share the presented comparison label", () => {
    const page = src("src/pages/OwnerDashboardPage.tsx");
    expect(page).toContain("commandCenterComparisonLabelKey");
    expect(page).toContain("comparisonLabelKey");
    expect(page).toContain("presentCommandCenterSparkline");
    expect(page).toContain("presentCommandCenterExpectedCash");
    expect(page).toContain("presentCommandCenterOfficialFinancials");

    const kpiGrid = src("src/components/command-center/CommandCenterKpiGrid.tsx");
    expect(kpiGrid).toContain("t(lang, comparisonLabelKey)");
    expect(kpiGrid).not.toContain('t(lang, "cmdCenterVsYesterday")');

    const finGrid = src("src/components/command-center/CommandCenterFinancialGrid.tsx");
    expect(finGrid).toContain("t(lang, comparisonLabelKey)");
    expect(finGrid).toContain("financial.trendVsPriorDay?.pctRevenue");
    expect(finGrid).not.toContain('t(lang, "cmdCenterVsYesterday")');

    const widgets = src("src/components/command-center/registry/retailDashboardWidgets.tsx");
    expect(widgets).toContain("comparisonLabelKey={ctx.comparisonLabelKey}");

    const helper = src("src/lib/commandCenterPageView.ts");
    expect(helper).toContain("presentCommandCenterSparkline");
    expect(helper).not.toContain("toISOString().slice(0, 10)");
  });
});
