import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DayCloseSummary } from "../types";
import { buildCommandCenterExportRows } from "./analyticsReportExport";
import { dayClosesForAuthority, resolvePeriodReportAuthority } from "./closedDayAuthority";
import {
  buildCommandCenterExportText,
  buildKpiCards,
  commandCenterOfficialExportValues,
  presentCommandCenterOfficialFinancials,
} from "./commandCenterPageView";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import type { OwnerFinancialExtended } from "./ownerCommandCenterBuilders";
import {
  canExportReportsData,
  resolveReportsFinancialReadiness,
  runReportsExportIfComplete,
  sumFrozenPeriodHeadlines,
} from "./reportsDataCompleteness";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const OPEN_DAY = "2026-08-13";
const CLOSED_DAY = "2026-08-12";
const ARCHIVED_DAY = "2026-04-10";

function bounds(fromKey: string, toKey = fromKey) {
  return { fromKey, toKey, isSingleDay: fromKey === toKey };
}

function closeFor(params: {
  id: string;
  dateKey: string;
  salesUgx: number;
  profitUgx: number;
  txn: number;
}): DayCloseSummary {
  const row = {
    id: params.id,
    dateKey: params.dateKey,
    expectedCashUgx: params.salesUgx,
    countedCashUgx: params.salesUgx,
    differenceUgx: 0,
    totalSalesUgx: params.salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: params.profitUgx,
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

const incompleteHydration = {
  hydrationStage: "interactive" as const,
  salesHistoryHydration: { active: true, loaded: 4, total: 10 },
};

const completeHydration = {
  hydrationStage: "complete" as const,
  salesHistoryHydration: null,
};

const returnsPendingHydration = {
  hydrationStage: "interactive" as const,
  salesHistoryHydration: null,
};

function present(input: {
  fromKey: string;
  toKey?: string;
  dayCloses: DayCloseSummary[];
  hydrationStage: "none" | "critical" | "interactive" | "background" | "complete";
  salesHistoryHydration: { active: boolean; loaded?: number; total?: number } | null;
  overlaid: { revenueUgx: number; profitUgx: number; transactionCount: number; costIncomplete?: boolean };
}) {
  const periodBounds = bounds(input.fromKey, input.toKey ?? input.fromKey);
  const authority = resolvePeriodReportAuthority(input.dayCloses, periodBounds);
  const readiness = resolveReportsFinancialReadiness({
    hydrationStage: input.hydrationStage,
    salesHistoryHydration: input.salesHistoryHydration,
    authority,
  });
  const frozenHeadlines = readiness.canShowFrozenHeadlines
    ? sumFrozenPeriodHeadlines(input.dayCloses, periodBounds)
    : null;
  const official = presentCommandCenterOfficialFinancials({
    readiness,
    overlaid: {
      revenueUgx: input.overlaid.revenueUgx,
      profitUgx: input.overlaid.profitUgx,
      transactionCount: input.overlaid.transactionCount,
      costIncomplete: input.overlaid.costIncomplete ?? false,
    },
    frozenHeadlines,
  });
  const cards = buildKpiCards(
    { ...emptyFinancial, ...input.overlaid, costIncomplete: input.overlaid.costIncomplete ?? false },
    null,
    3,
    [],
    official,
  );
  const exportValues = commandCenterOfficialExportValues(official);
  const exportPayload = runReportsExportIfComplete(readiness.dataComplete, () => {
    if (!exportValues) return null;
    return {
      csv: buildCommandCenterExportRows({
        lang: "en",
        shopName: "Waka",
        periodLabel: input.fromKey,
        score: 80,
        revenueUgx: exportValues.revenueUgx,
        profitUgx: exportValues.profitUgx,
        costIncomplete: exportValues.costIncomplete,
        transactions: exportValues.transactionCount,
        expectedCashUgx: null,
      }),
      text: buildCommandCenterExportText({
        shopName: "Waka",
        periodLabel: input.fromKey,
        score: 80,
        revenueUgx: exportValues.revenueUgx,
        profitUgx: exportValues.profitUgx,
        costIncomplete: exportValues.costIncomplete,
        transactions: exportValues.transactionCount,
        expectedCashUgx: null,
      }),
    };
  });
  return { official, cards, exportPayload, readiness, exportValues };
}

function kpiValue(cards: ReturnType<typeof buildKpiCards>, id: string): string | undefined {
  return cards.find((card) => card.id === id)?.value;
}

describe("CC-P2-03 Command Center official financial readiness", () => {
  it("TEST 1 — complete open period presents live headlines", () => {
    const shown = present({
      fromKey: OPEN_DAY,
      dayCloses: [],
      ...completeHydration,
      overlaid: { revenueUgx: 500_000, profitUgx: 200_000, transactionCount: 10 },
    });
    expect(shown.official.headlineSource).toBe("overlay");
    expect(shown.official.presentHeadlinesAsFinal).toBe(true);
    expect(shown.official.revenueUgx).toBe(500_000);
    expect(shown.official.profitUgx).toBe(200_000);
    expect(shown.official.transactionCount).toBe(10);
    expect(kpiValue(shown.cards, "revenue")).toBe("UGX 500,000");
    expect(kpiValue(shown.cards, "profit")).toBe("UGX 200,000");
    expect(kpiValue(shown.cards, "transactions")).toBe("10");
    expect(kpiValue(shown.cards, "avg-sale")).toBe("UGX 50,000");
    expect(canExportReportsData(shown.readiness)).toBe(true);
  });

  it("TEST 2 — incomplete open period does not present partial headlines as final", () => {
    const shown = present({
      fromKey: OPEN_DAY,
      dayCloses: [],
      ...incompleteHydration,
      overlaid: { revenueUgx: 200_000, profitUgx: 80_000, transactionCount: 4 },
    });
    expect(shown.official.headlineSource).toBe("hidden");
    expect(shown.official.presentHeadlinesAsFinal).toBe(false);
    expect(shown.official.revenueUgx).toBeNull();
    expect(shown.official.profitUgx).toBeNull();
    expect(shown.official.transactionCount).toBeNull();
    expect(kpiValue(shown.cards, "revenue")).toBe("—");
    expect(kpiValue(shown.cards, "profit")).toBe("—");
    expect(kpiValue(shown.cards, "transactions")).toBe("—");
    expect(kpiValue(shown.cards, "avg-sale")).toBe("—");
    expect(kpiValue(shown.cards, "customers")).toBe("3");
    expect(shown.cards.flatMap((card) => [card.value, card.pctChange]).join(" ")).not.toContain("200,000");
    expect(shown.cards.flatMap((card) => [card.value, card.pctChange]).join(" ")).not.toContain("80,000");
  });

  it("TEST 3 — incomplete export does not emit partial financials", () => {
    const shown = present({
      fromKey: OPEN_DAY,
      dayCloses: [],
      ...incompleteHydration,
      overlaid: { revenueUgx: 200_000, profitUgx: 80_000, transactionCount: 4 },
    });
    expect(canExportReportsData(shown.readiness)).toBe(false);
    expect(shown.exportValues).toBeNull();
    expect(shown.exportPayload).toBeNull();
  });

  it("TEST 4 — complete export matches the existing financial values", () => {
    const shown = present({
      fromKey: OPEN_DAY,
      dayCloses: [],
      ...completeHydration,
      overlaid: { revenueUgx: 500_000, profitUgx: 200_000, transactionCount: 10 },
    });
    expect(shown.exportPayload).not.toBeNull();
    expect(shown.exportPayload?.csv.some((row) => row[1] === 500_000)).toBe(true);
    expect(shown.exportPayload?.csv.some((row) => row[1] === 200_000)).toBe(true);
    expect(shown.exportPayload?.csv.some((row) => row[1] === 10)).toBe(true);
    expect(shown.exportPayload?.text).toContain("UGX 500,000");
    expect(shown.exportPayload?.text).toContain("UGX 200,000");
    expect(shown.exportPayload?.text).toContain("Transactions: 10");
  });

  it("TEST 5 — active closed day keeps frozen headlines while live hydration is incomplete", () => {
    const closed = closeFor({
      id: "active-closed",
      dateKey: CLOSED_DAY,
      salesUgx: 500_000,
      profitUgx: 100_000,
      txn: 8,
    });
    const shown = present({
      fromKey: CLOSED_DAY,
      dayCloses: [closed],
      ...incompleteHydration,
      overlaid: { revenueUgx: 200_000, profitUgx: 80_000, transactionCount: 4 },
    });
    expect(shown.official.headlineSource).toBe("frozen");
    expect(shown.official.revenueUgx).toBe(500_000);
    expect(shown.official.profitUgx).toBe(100_000);
    expect(shown.official.transactionCount).toBe(8);
    expect(shown.official.revenueUgx).not.toBe(200_000);
    expect(kpiValue(shown.cards, "revenue")).toBe("UGX 500,000");
    expect(kpiValue(shown.cards, "profit")).toBe("UGX 100,000");
    expect(canExportReportsData(shown.readiness)).toBe(false);
    expect(shown.exportPayload).toBeNull();
  });

  it("TEST 6 — archived closed day keeps frozen archived headlines", () => {
    const archived = closeFor({
      id: "arch-closed",
      dateKey: ARCHIVED_DAY,
      salesUgx: 500_000,
      profitUgx: 100_000,
      txn: 8,
    });
    const shown = present({
      fromKey: ARCHIVED_DAY,
      dayCloses: dayClosesForAuthority([], [archived]),
      ...incompleteHydration,
      overlaid: { revenueUgx: 90_000, profitUgx: 20_000, transactionCount: 2 },
    });
    expect(shown.official.headlineSource).toBe("frozen");
    expect(shown.official.revenueUgx).toBe(500_000);
    expect(shown.official.profitUgx).toBe(100_000);
    expect(shown.official.revenueUgx).not.toBe(90_000);
    expect(kpiValue(shown.cards, "revenue")).toBe("UGX 500,000");
  });

  it("TEST 7 — mixed archived + open period does not present partial combined totals", () => {
    const archived = closeFor({
      id: "arch-closed",
      dateKey: ARCHIVED_DAY,
      salesUgx: 500_000,
      profitUgx: 100_000,
      txn: 8,
    });
    const shown = present({
      fromKey: ARCHIVED_DAY,
      toKey: OPEN_DAY,
      dayCloses: dayClosesForAuthority([], [archived]),
      ...incompleteHydration,
      overlaid: { revenueUgx: 590_000, profitUgx: 140_000, transactionCount: 10 },
    });
    expect(resolvePeriodReportAuthority(dayClosesForAuthority([], [archived]), bounds(ARCHIVED_DAY, OPEN_DAY))).toBe(
      "mixed",
    );
    expect(shown.official.headlineSource).toBe("hidden");
    expect(shown.official.revenueUgx).toBeNull();
    expect(kpiValue(shown.cards, "revenue")).toBe("—");
    expect(kpiValue(shown.cards, "profit")).toBe("—");
    expect(shown.exportPayload).toBeNull();
    expect(shown.cards.map((card) => card.value).join(" ")).not.toContain("590,000");
  });

  it("TEST 8 — remainder/returns hydration keeps official headlines hidden", () => {
    const shown = present({
      fromKey: OPEN_DAY,
      dayCloses: [],
      ...returnsPendingHydration,
      overlaid: { revenueUgx: 500_000, profitUgx: 200_000, transactionCount: 10 },
    });
    expect(shown.readiness.remainderReady).toBe(false);
    expect(shown.readiness.dataComplete).toBe(false);
    expect(shown.official.headlineSource).toBe("hidden");
    expect(shown.official.presentHeadlinesAsFinal).toBe(false);
    expect(shown.exportPayload).toBeNull();
  });

  it("TEST 9 — live operational widgets stay independent of the financial gate", () => {
    const page = src("src/pages/OwnerDashboardPage.tsx");
    expect(page).toContain("presentCommandCenterOfficialFinancials");
    expect(page).toContain("resolveReportsFinancialReadiness");
    expect(page).not.toContain("commandCenter.liveOps =");

    const widgets = src("src/components/command-center/registry/retailDashboardWidgets.tsx");
    expect(widgets).toContain("ctx.commandCenter.liveOps");
    expect(widgets).toContain("ctx.heroExpectedCash");
    expect(widgets).toContain("CommandCenterCloudCard");
    expect(widgets).toContain("CommandCenterInventoryCard");
    expect(widgets.indexOf("LiveOpsWidget")).toBeLessThan(widgets.indexOf("officialFinancials={ctx.officialFinancials}"));
  });

  it("TEST 10 — complete hydration screen equals CSV, share, and PDF source", () => {
    const shown = present({
      fromKey: OPEN_DAY,
      dayCloses: [],
      ...completeHydration,
      overlaid: { revenueUgx: 500_000, profitUgx: 200_000, transactionCount: 10 },
    });
    expect(shown.official.revenueUgx).toBe(500_000);
    expect(shown.official.profitUgx).toBe(200_000);
    expect(shown.official.transactionCount).toBe(10);
    expect(kpiValue(shown.cards, "revenue")).toBe("UGX 500,000");
    expect(kpiValue(shown.cards, "profit")).toBe("UGX 200,000");
    expect(shown.exportPayload?.csv.some((row) => row[1] === shown.official.revenueUgx)).toBe(true);
    expect(shown.exportPayload?.csv.some((row) => row[1] === shown.official.profitUgx)).toBe(true);
    expect(shown.exportPayload?.csv.some((row) => row[1] === shown.official.transactionCount)).toBe(true);
    expect(shown.exportPayload?.text).toContain("UGX 500,000");
    expect(shown.exportPayload?.text).toContain("UGX 200,000");
    expect(shown.exportPayload?.text).toBe(
      buildCommandCenterExportText({
        shopName: "Waka",
        periodLabel: OPEN_DAY,
        score: 80,
        revenueUgx: shown.official.revenueUgx!,
        profitUgx: shown.official.profitUgx!,
        transactions: shown.official.transactionCount!,
        expectedCashUgx: null,
      }),
    );
  });
});

describe("CC-P2-03 source wiring", () => {
  it("Owner Command Center reuses Reports readiness helpers and gates every official export", () => {
    const page = src("src/pages/OwnerDashboardPage.tsx");
    expect(page).toContain("resolveReportsFinancialReadiness");
    expect(page).toContain("sumFrozenPeriodHeadlines");
    expect(page).toContain("presentCommandCenterOfficialFinancials");
    expect(page).toContain("canExportReportsData");
    expect(page).toContain("runReportsExportIfComplete");
    expect(page).toContain("commandCenterOfficialExportValues");
    expect(page).toContain("useDayClosesForAuthority");
    expect(page).toContain("presentCommandCenterExpectedCash");
    expect(page).not.toContain("can: () => false");

    const helper = src("src/lib/commandCenterPageView.ts");
    expect(helper).toContain("canExportReportsData");
    expect(helper).not.toContain("new hydration");
  });
});
