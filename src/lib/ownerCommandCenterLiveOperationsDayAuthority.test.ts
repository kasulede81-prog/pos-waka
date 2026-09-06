import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import type { DayCloseSummary, DayDrawerOpen } from "../types";
import { dayClosesForAuthority } from "./closedDayAuthority";
import { presentCommandCenterExpectedCash } from "./commandCenterPageView";
import { resolveDateFilterBounds } from "./dateFilters";
import { dateKeyKampala } from "./datesUg";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { buildOwnerCommandCenterBundle } from "./ownerDashboardCommandCenter";
import type { OwnerCommandCenterInput } from "./ownerCommandCenter";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const TODAY = dateKeyKampala(new Date());
const CUSTOM_FROM = "2026-04-01";
const CUSTOM_TO = "2026-04-10";
const TODAY_FLOAT = 77_000;
const YESTERDAY_FLOAT = 11_000;
const CUSTOM_FLOAT = 44_000;
const LIVE_EXPECTED_CASH = 150_000;
const FROZEN_EXPECTED_CASH = 95_000;
const ARCHIVED_EXPECTED_CASH = 80_000;

function drawer(dateKey: string, openingFloatUgx: number): DayDrawerOpen {
  return {
    id: `open-${dateKey}`,
    dateKey,
    openingFloatUgx,
    countedAt: `${dateKey}T07:00:00.000Z`,
    countedByUserId: "owner",
    countedByLabel: "Owner",
    note: "",
    deviceId: "dev-1",
    status: "open",
    createdAt: `${dateKey}T07:00:00.000Z`,
    updatedAt: `${dateKey}T07:00:00.000Z`,
    pendingSync: false,
  };
}

function closeFor(params: { id: string; dateKey: string; expectedCashUgx: number }): DayCloseSummary {
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
    supersededAt: null,
    pendingSync: false,
    updatedAt: `${params.dateKey}T18:00:00.000Z`,
  };
}

function emptyBundleInput(
  bounds: OwnerCommandCenterInput["bounds"],
  extras?: Partial<OwnerCommandCenterInput>,
): OwnerCommandCenterInput {
  const yesterday = resolveDateFilterBounds({ kind: "preset", preset: "yesterday" }).fromKey;
  return {
    lang: "en",
    bounds,
    sales: [],
    products: [],
    customers: [],
    suppliers: [],
    shifts: [],
    dayCloses: extras?.dayCloses ?? [],
    dayDrawerOpens: extras?.dayDrawerOpens ?? [
      drawer(TODAY, TODAY_FLOAT),
      drawer(yesterday, YESTERDAY_FLOAT),
      drawer(CUSTOM_TO, CUSTOM_FLOAT),
    ],
    cashDrawerAdjustments: [],
    cashExpenses: [],
    debtPayments: [],
    stockMovements: [],
    inventoryCountSessions: [],
    auditLogs: [],
    voidRecords: [],
    returnRecords: [],
    purchases: [],
    supplierPayments: [],
    preferences: createDefaultPreferences(),
    acknowledgements: [],
    expectedCashUgx: extras?.expectedCashUgx ?? LIVE_EXPECTED_CASH,
    pharmacyMode: false,
    syncPendingCount: 0,
    syncErrorCount: 0,
    ...extras,
  };
}

function liveOpsFor(bounds: OwnerCommandCenterInput["bounds"], extras?: Partial<OwnerCommandCenterInput>) {
  return buildOwnerCommandCenterBundle(emptyBundleInput(bounds, extras)).liveOps;
}

describe("CC-P2-06 Owner Command Center live operations day authority", () => {
  it("TEST 1 — Today filter keeps live ops on today's Kampala key", () => {
    const bounds = resolveDateFilterBounds({ kind: "preset", preset: "today" });
    expect(bounds.toKey).toBe(TODAY);
    const live = liveOpsFor(bounds);
    expect(live.dayDrawerOpen).toBe(true);
    expect(live.openingFloatUgx).toBe(TODAY_FLOAT);
  });

  it("TEST 2 — Yesterday filter does not key live ops to yesterday", () => {
    const bounds = resolveDateFilterBounds({ kind: "preset", preset: "yesterday" });
    expect(bounds.toKey).not.toBe(TODAY);
    const live = liveOpsFor(bounds);
    expect(live.dayDrawerOpen).toBe(true);
    expect(live.openingFloatUgx).toBe(TODAY_FLOAT);
    expect(live.openingFloatUgx).not.toBe(YESTERDAY_FLOAT);
  });

  it("TEST 3 — This week does not key live ops to week end via bounds.toKey", () => {
    const bounds = resolveDateFilterBounds({ kind: "preset", preset: "this_week" });
    const live = liveOpsFor(bounds);
    expect(live.dayDrawerOpen).toBe(true);
    expect(live.openingFloatUgx).toBe(TODAY_FLOAT);
  });

  it("TEST 4 — This month does not key live ops to month end via bounds.toKey", () => {
    const bounds = resolveDateFilterBounds({ kind: "preset", preset: "this_month" });
    const live = liveOpsFor(bounds);
    expect(live.dayDrawerOpen).toBe(true);
    expect(live.openingFloatUgx).toBe(TODAY_FLOAT);
  });

  it("TEST 5 — Custom historical range uses today's Kampala key, not range end", () => {
    const bounds = resolveDateFilterBounds({
      kind: "range",
      fromKey: CUSTOM_FROM,
      toKey: CUSTOM_TO,
    });
    expect(bounds.toKey).toBe(CUSTOM_TO);
    expect(bounds.toKey).not.toBe(TODAY);
    const live = liveOpsFor(bounds);
    expect(live.dayDrawerOpen).toBe(true);
    expect(live.openingFloatUgx).toBe(TODAY_FLOAT);
    expect(live.openingFloatUgx).not.toBe(CUSTOM_FLOAT);
  });

  it("TEST 6 — All-time range still uses today's live operational day", () => {
    const bounds = resolveDateFilterBounds({
      kind: "range",
      fromKey: "2020-01-01",
      toKey: TODAY,
    });
    expect(bounds.toKey).toBe(TODAY);
    const live = liveOpsFor(bounds);
    expect(live.dayDrawerOpen).toBe(true);
    expect(live.openingFloatUgx).toBe(TODAY_FLOAT);
  });

  it("TEST 7 — closed historical Expected Cash stays frozen while live ops uses today", () => {
    const bounds = resolveDateFilterBounds({ kind: "day", dateKey: CUSTOM_TO });
    const closed = closeFor({ id: "active-custom", dateKey: CUSTOM_TO, expectedCashUgx: FROZEN_EXPECTED_CASH });
    const bundle = buildOwnerCommandCenterBundle(
      emptyBundleInput(bounds, { dayCloses: [closed], expectedCashUgx: LIVE_EXPECTED_CASH }),
    );
    const shown = presentCommandCenterExpectedCash(bounds, [closed], LIVE_EXPECTED_CASH);
    expect(shown).toBe(FROZEN_EXPECTED_CASH);
    expect(shown).not.toBe(LIVE_EXPECTED_CASH);
    expect(bundle.liveOps.openingFloatUgx).toBe(TODAY_FLOAT);
    expect(bundle.cash.primaryDayKey).toBe(CUSTOM_TO);
    expect(bundle.cash.openingFloatUgx).toBe(CUSTOM_FLOAT);
  });

  it("TEST 8 — archived historical close stays financial authority; live ops stays today", () => {
    const bounds = resolveDateFilterBounds({ kind: "day", dateKey: CUSTOM_TO });
    const archived = closeFor({
      id: "arch-custom",
      dateKey: CUSTOM_TO,
      expectedCashUgx: ARCHIVED_EXPECTED_CASH,
    });
    const merged = dayClosesForAuthority([], [archived]);
    const bundle = buildOwnerCommandCenterBundle(
      emptyBundleInput(bounds, { dayCloses: merged, expectedCashUgx: LIVE_EXPECTED_CASH }),
    );
    const shown = presentCommandCenterExpectedCash(bounds, merged, LIVE_EXPECTED_CASH);
    expect(shown).toBe(ARCHIVED_EXPECTED_CASH);
    expect(shown).not.toBe(LIVE_EXPECTED_CASH);
    expect(bundle.liveOps.openingFloatUgx).toBe(TODAY_FLOAT);
    expect(bundle.cash.primaryDayKey).toBe(CUSTOM_TO);
  });
});

describe("CC-P2-06 source wiring", () => {
  it("live operations use dateKeyKampala(new Date()); cash stays on bounds.toKey", () => {
    const bundleSrc = src("src/lib/ownerDashboardCommandCenter.ts");
    expect(bundleSrc).toContain("primaryDayKey: dateKeyKampala(new Date())");
    expect(bundleSrc).toContain("primaryDayKey: input.bounds.toKey");
    expect(bundleSrc).not.toContain("getOwnerLiveDayKey");
    expect(bundleSrc).not.toContain("getCommandCenterTodayKey");
    expect(bundleSrc).not.toContain("toISOString().slice(0, 10)");

    const liveOpsBlock = bundleSrc.slice(
      bundleSrc.indexOf("liveOps: buildLiveOperationsSnapshot"),
      bundleSrc.indexOf("cash: buildCashControlExtended"),
    );
    expect(liveOpsBlock).toContain("dateKeyKampala(new Date())");
    expect(liveOpsBlock).not.toContain("input.bounds.toKey");

    const cashBlock = bundleSrc.slice(
      bundleSrc.indexOf("cash: buildCashControlExtended"),
      bundleSrc.indexOf("inventory: buildInventoryExtended"),
    );
    expect(cashBlock).toContain("primaryDayKey: input.bounds.toKey");
    expect(cashBlock).not.toContain("dateKeyKampala(new Date())");
  });

  it("does not invent a second timezone helper or rewrite live-ops copy", () => {
    const i18n = src("src/lib/i18n.ts");
    expect(i18n).toContain('ownerLiveOpsSub: "Shifts, drawer, devices, and sync right now"');

    const page = src("src/pages/OwnerDashboardPage.tsx");
    expect(page).toContain("presentCommandCenterExpectedCash");
    expect(page).toContain("getCachedOwnerCommandCenterBundle");

    const widgets = src("src/components/command-center/registry/retailDashboardWidgets.tsx");
    expect(widgets).toContain("ctx.commandCenter.liveOps");
    expect(widgets).toContain("expectedCashUgx={ctx.heroExpectedCash");
  });
});
