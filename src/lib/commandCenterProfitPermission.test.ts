import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Permission, UserRole } from "../types";
import { buildCommandCenterExportRows } from "./analyticsReportExport";
import { reportsInventoryCostPresentation } from "../features/business-analytics/lib/analyticsPageView";
import {
  buildCommandCenterExportText,
  buildKpiCards,
  presentCommandCenterOfficialFinancials,
} from "./commandCenterPageView";
import { hasPermission } from "./permissions";
import { resolveProfitVisibility } from "./profitVisibility";
import { resolveReportsFinancialReadiness } from "./reportsDataCompleteness";
import type { OwnerFinancialExtended } from "./ownerCommandCenterBuilders";
import type { RemoteSubscriptionRow, SubscriptionSnapshot } from "./subscriptionEntitlements";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const LOCAL: SubscriptionSnapshot = { kind: "local_full" };
const STARTER: SubscriptionSnapshot = {
  kind: "remote",
  row: {
    id: "1",
    organization_id: "o1",
    shop_id: "s1",
    plan_code: "starter",
    status: "active",
    trial_ends_at: null,
    current_period_start: null,
    current_period_end: null,
    max_pos_users: null,
    max_shops: null,
    max_devices: null,
  } as RemoteSubscriptionRow,
};

function visibility(role: UserRole, actorPermissions?: Permission[] | null, snapshot: SubscriptionSnapshot = LOCAL) {
  return resolveProfitVisibility({
    role,
    snapshot,
    authMode: snapshot.kind === "local_full" ? "local" : "supabase",
    actorPermissions,
  });
}

const emptyFinancial: OwnerFinancialExtended = {
  revenueUgx: 500_000,
  profitUgx: 100_000,
  transactionCount: 4,
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

const official = presentCommandCenterOfficialFinancials({
  readiness: resolveReportsFinancialReadiness({
    hydrationStage: "complete",
    salesHistoryHydration: null,
    authority: "live",
  }),
  overlaid: { revenueUgx: 500_000, profitUgx: 100_000, transactionCount: 4, costIncomplete: false },
  frozenHeadlines: null,
});

function present(canProfit: boolean, profitUgx = 100_000, revenueUgx = 500_000, inventoryValueUgx = 2_000_000) {
  const cards = buildKpiCards(
    { ...emptyFinancial, revenueUgx, profitUgx },
    null,
    2,
    [],
    { ...official, revenueUgx, profitUgx },
    canProfit,
  );
  const csv = buildCommandCenterExportRows({
    lang: "en",
    shopName: "Waka",
    periodLabel: "Today",
    score: 80,
    revenueUgx,
    profitUgx: canProfit ? profitUgx : undefined,
    transactions: 4,
    expectedCashUgx: null,
    includeProfit: canProfit,
  });
  const text = buildCommandCenterExportText({
    shopName: "Waka",
    periodLabel: "Today",
    score: 80,
    revenueUgx,
    profitUgx: canProfit ? profitUgx : undefined,
    transactions: 4,
    expectedCashUgx: null,
    includeProfit: canProfit,
  });
  const inventory = reportsInventoryCostPresentation(canProfit, inventoryValueUgx);
  return { cards, csv, text, inventory };
}

describe("CC-P2-07 Command Center reports.profit visibility", () => {
  it("TEST 1 — owner.dashboard + reports.profit keeps Gross Profit visible", () => {
    const vis = visibility("owner");
    expect(hasPermission("owner", "owner.dashboard")).toBe(true);
    expect(vis.canProfit).toBe(true);
    const shown = present(vis.canProfit);
    expect(shown.cards.find((c) => c.id === "profit")?.value).toBe("UGX 100,000");
  });

  it("TEST 2 — owner.dashboard without reports.profit hides Gross Profit", () => {
    const vis = visibility("cashier", ["owner.dashboard"]);
    expect(vis.canProfit).toBe(false);
    const shown = present(vis.canProfit);
    expect(shown.cards.find((c) => c.id === "profit")).toBeUndefined();
    expect(shown.cards.map((c) => c.value).join(" ")).not.toContain("100,000");
  });

  it("TEST 3 — owner.dashboard without reports.profit hides inventory-at-cost", () => {
    const vis = visibility("cashier", ["owner.dashboard"]);
    const shown = present(vis.canProfit);
    expect(shown.inventory).toEqual({ visible: false });
    expect(shown.inventory).not.toEqual({ visible: true, valueUgx: 2_000_000 });
  });

  it("TEST 4 — unauthorized CSV contains no profit value", () => {
    const shown = present(false);
    expect(shown.csv.flat().join(" ")).not.toContain("100000");
    expect(shown.csv.flat().join(" ")).not.toContain("100,000");
    expect(shown.csv.some((row) => String(row[0]).toLowerCase().includes("profit"))).toBe(false);
  });

  it("TEST 5 — unauthorized share contains no profit value", () => {
    const shown = present(false);
    expect(shown.text.toLowerCase()).not.toContain("gross profit");
    expect(shown.text).not.toContain("100,000");
    expect(shown.text).not.toContain("UGX 100000");
  });

  it("TEST 6 — unauthorized PDF source contains no profit value", () => {
    const shown = present(false);
    expect(shown.text).toBe(
      buildCommandCenterExportText({
        shopName: "Waka",
        periodLabel: "Today",
        score: 80,
        revenueUgx: 500_000,
        transactions: 4,
        expectedCashUgx: null,
        includeProfit: false,
      }),
    );
    expect(shown.text.toLowerCase()).not.toContain("profit");
  });

  it("TEST 7 — authorized export preserves existing profit", () => {
    const shown = present(true);
    expect(shown.csv.some((row) => row[1] === 100_000)).toBe(true);
    expect(shown.text).toContain("Gross profit: UGX 100,000");
  });

  it("TEST 8 — Revenue remains visible without reports.profit", () => {
    const shown = present(false);
    expect(shown.cards.find((c) => c.id === "revenue")?.value).toBe("UGX 500,000");
    expect(shown.csv.some((row) => row[1] === 500_000)).toBe(true);
    expect(shown.text).toContain("Revenue: UGX 500,000");
  });

  it("TEST 9 — Transactions remain visible without reports.profit", () => {
    const shown = present(false);
    expect(shown.cards.find((c) => c.id === "transactions")?.value).toBe("4");
    expect(shown.text).toContain("Transactions: 4");
  });

  it("TEST 10 — authorized profit still obeys CC-P2-03 incomplete readiness", () => {
    const vis = visibility("owner");
    expect(vis.canProfit).toBe(true);
    const incomplete = presentCommandCenterOfficialFinancials({
      readiness: resolveReportsFinancialReadiness({
        hydrationStage: "interactive",
        salesHistoryHydration: { active: true, loaded: 1, total: 5 },
        authority: "live",
      }),
      overlaid: { revenueUgx: 200_000, profitUgx: 80_000, transactionCount: 2, costIncomplete: false },
      frozenHeadlines: null,
    });
    expect(incomplete.presentHeadlinesAsFinal).toBe(false);
    const cards = buildKpiCards(emptyFinancial, null, 0, [], incomplete, vis.canProfit);
    expect(cards.find((c) => c.id === "profit")?.value).toBe("—");
    expect(cards.find((c) => c.id === "profit")?.value).not.toBe("UGX 80,000");
    expect(cards.find((c) => c.id === "revenue")?.value).toBe("—");
  });

  it("TEST 11 — archived frozen profit is not leaked to an unauthorized user", () => {
    const vis = visibility("cashier", ["owner.dashboard"]);
    const frozen = presentCommandCenterOfficialFinancials({
      readiness: resolveReportsFinancialReadiness({
        hydrationStage: "interactive",
        salesHistoryHydration: { active: true, loaded: 1, total: 5 },
        authority: "closed_snapshot",
      }),
      overlaid: { revenueUgx: 9_000, profitUgx: 1_000, transactionCount: 1, costIncomplete: false },
      frozenHeadlines: { revenue: 500_000, profit: 100_000, count: 4, debt: 0, cash: 0, cashUnavailable: true },
    });
    expect(frozen.headlineSource).toBe("frozen");
    expect(frozen.profitUgx).toBe(100_000);
    const shown = present(vis.canProfit, frozen.profitUgx ?? 0, frozen.revenueUgx ?? 0);
    expect(shown.cards.find((c) => c.id === "profit")).toBeUndefined();
    expect(shown.text).not.toContain("100,000");
    expect(shown.csv.flat().join(" ")).not.toContain("100000");
  });

  it("TEST 12 — archived frozen profit remains for an authorized user", () => {
    const vis = visibility("owner");
    const frozen = presentCommandCenterOfficialFinancials({
      readiness: resolveReportsFinancialReadiness({
        hydrationStage: "complete",
        salesHistoryHydration: null,
        authority: "closed_snapshot",
      }),
      overlaid: { revenueUgx: 500_000, profitUgx: 100_000, transactionCount: 4, costIncomplete: false },
      frozenHeadlines: { revenue: 500_000, profit: 100_000, count: 4, debt: 0, cash: 0, cashUnavailable: true },
    });
    const cards = buildKpiCards(emptyFinancial, null, 0, [], frozen, vis.canProfit);
    expect(cards.find((c) => c.id === "profit")?.value).toBe("UGX 100,000");
  });

  it("standard owner keeps both dashboard access and profit; manager has profit but not owner.dashboard", () => {
    expect(hasPermission("owner", "owner.dashboard")).toBe(true);
    expect(visibility("owner").canProfit).toBe(true);
    expect(hasPermission("manager", "owner.dashboard")).toBe(false);
    expect(visibility("manager").canProfit).toBe(true);
    expect(visibility("cashier", ["owner.dashboard", "reports.profit"], STARTER).canProfit).toBe(true);
  });
});

describe("CC-P2-07 source wiring", () => {
  it("Owner Command Center uses resolveProfitVisibility and does not hardcode can true", () => {
    const page = src("src/pages/OwnerDashboardPage.tsx");
    expect(page).toContain("resolveProfitVisibility");
    expect(page).toContain("actorHasEffectivePermission");
    expect(page).toContain("authOperatorPermissions");
    expect(page).toContain("includeProfit: canProfit");
    expect(page).not.toContain("can: () => true");
    expect(page).not.toContain('role === "owner"');

    const inventory = src("src/components/command-center/CommandCenterInventoryCard.tsx");
    expect(inventory).toContain("reportsInventoryCostPresentation");

    const reports = src("src/features/business-analytics/EnterpriseReportsShell.tsx");
    expect(reports).toContain("resolveProfitVisibility");
  });
});
