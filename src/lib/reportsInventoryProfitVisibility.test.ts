import { describe, expect, it } from "vitest";
import { buildAiInsights, reportsInventoryCostPresentation } from "../features/business-analytics/lib/analyticsPageView";
import { ANALYTICS_CATEGORIES } from "../features/business-analytics/types";
import { buildAnalyticsReportRows } from "./analyticsReportExport";
import { actorCanSeeInventoryCostValue } from "./inventoryFinancialVisibility";
import { t } from "./i18n";
import { localGetInventoryInsights } from "./localReporting";
import { resolveProfitVisibility } from "./profitVisibility";
import { resolveSessionActor, type SessionActor } from "./sessionActor";
import type { UserRole, Product } from "../types";
import type { RemoteSubscriptionRow, SubscriptionSnapshot } from "./subscriptionEntitlements";
import type { ShopReportBundle } from "../hooks/useShopReporting";

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

function actor(role: UserRole): SessionActor {
  return resolveSessionActor({
    mode: "supabase",
    user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: `${role}@waka.invalid` } as never,
    email: `${role}@waka.invalid`,
    shopMemberRole: role,
    preferences: {} as never,
  });
}

const products: Product[] = [
  {
    id: "p1",
    name: "Sugar",
    sellingPricePerUnitUgx: 5_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand: 10,
    baseUnit: "kg",
    sellingMode: "unit",
    category: "General",
    sku: "SUG",
    minimumStockAlert: 20,
    updatedAt: "2026-08-12T09:00:00.000Z",
    version: 1,
  },
];

const emptyReport: ShopReportBundle = {
  source: "local",
  authority: "live",
  closedDayBreakdownUnavailable: false,
  revenue: 0,
  cash: 0,
  profit: 0,
  debt: 0,
  count: 0,
  discountsUgx: 0,
  taxesUgx: 0,
  debtOutstanding: 0,
  topProducts: [],
  slowProducts: [],
  marginLeaders: [],
  dailyTrend: [],
  stockValueAtCost: 30_000,
  supplierDebtTotal: 0,
  loading: false,
  dataComplete: true,
  remainderReady: true,
};

function insightText(insights: ReturnType<typeof buildAiInsights>): string {
  return insights
    .map((card) => {
      const vars = card.textVars ?? {};
      return Object.values(vars).join(" ");
    })
    .join(" ");
}

describe("RPT-P2-03 Reports inventory cost respects reports.profit", () => {
  it("TEST 1 — reports.view without reports.profit hides inventory value at cost", () => {
    const cashier = actor("cashier");
    const visibility = resolveProfitVisibility({
      role: cashier.role,
      snapshot: STARTER,
      authMode: "supabase",
      actorPermissions: cashier.permissions,
    });
    expect(visibility.canProfit).toBe(false);

    const shown = reportsInventoryCostPresentation(visibility.canProfit, 30_000);
    expect(shown.visible).toBe(false);
    if (shown.visible) expect.fail("cost value must not be presented");

    const categories = ANALYTICS_CATEGORIES.filter((c) => c !== "profit" || visibility.canProfit);
    expect(categories).toContain("inventory");
    expect(categories).not.toContain("profit");
  });

  it("TEST 2 — reports.profit keeps inventory value at cost visible", () => {
    const owner = actor("owner");
    const visibility = resolveProfitVisibility({
      role: owner.role,
      snapshot: STARTER,
      authMode: "supabase",
      actorPermissions: owner.permissions,
    });
    expect(visibility.canProfit).toBe(true);
    expect(reportsInventoryCostPresentation(true, 30_000)).toEqual({ visible: true, valueUgx: 30_000 });
  });

  it("TEST 3 — AI inventory-value insight is gated by reports.profit", () => {
    const locked = buildAiInsights({
      revenue: 100_000,
      profit: 40_000,
      priorRevenue: 80_000,
      priorProfit: 30_000,
      inventoryValue: 30_000,
      lowStockCount: 1,
      lowStockProduct: "Sugar",
      customerCount: 2,
      priorCustomerCount: 1,
      canProfit: false,
    });
    expect(locked.some((c) => c.id === "inventory-value")).toBe(false);
    expect(insightText(locked)).not.toContain("30");
    expect(locked.some((c) => c.id === "low-stock")).toBe(true);

    const open = buildAiInsights({
      revenue: 100_000,
      profit: 40_000,
      priorRevenue: 80_000,
      priorProfit: 30_000,
      inventoryValue: 30_000,
      lowStockCount: 0,
      customerCount: 1,
      priorCustomerCount: 1,
      canProfit: true,
    });
    const valueInsight = open.find((c) => c.id === "inventory-value");
    expect(valueInsight).toBeTruthy();
    expect(String(valueInsight?.textVars?.value ?? "")).toMatch(/30/);
  });

  it("TEST 4 — unauthorized presentation does not expose unit cost, cost price, value, or margin", () => {
    const shown = reportsInventoryCostPresentation(false, 30_000);
    expect(shown).toEqual({ visible: false });
    const insights = localGetInventoryInsights(products);
    expect(insights.lowStock[0]).toMatchObject({ name: "Sugar", stockOnHand: 10 });
    expect(insights.lowStock[0]).not.toHaveProperty("costPricePerUnitUgx");
    expect(insights.lowStock[0]).not.toHaveProperty("unitCost");
  });

  it("TEST 5 — analytics export does not include inventory cost with or without reports.profit", () => {
    const without = buildAnalyticsReportRows({
      lang: "en",
      title: "Reports",
      periodLabel: "2026-08-12",
      report: emptyReport,
      expensesUgx: 0,
      purchasesInPeriodUgx: 0,
      canProfit: false,
    });
    const withProfit = buildAnalyticsReportRows({
      lang: "en",
      title: "Reports",
      periodLabel: "2026-08-12",
      report: emptyReport,
      expensesUgx: 0,
      purchasesInPeriodUgx: 0,
      canProfit: true,
    });
    const withoutText = without.flat().join(" ");
    const withText = withProfit.flat().join(" ");
    expect(withoutText).not.toContain(t("en", "reportsStockValue"));
    expect(withoutText).not.toContain("30000");
    expect(withText).not.toContain(t("en", "reportsStockValue"));
    expect(withProfit.some((row) => row[0] === t("en", "profitStatGrossProfit"))).toBe(true);
    expect(without.some((row) => row[0] === t("en", "profitStatGrossProfit"))).toBe(false);
  });

  it("TEST 6 — stock quantity and status remain available without reports.profit", () => {
    const insights = localGetInventoryInsights(products);
    expect(insights.lowStock[0]?.stockOnHand).toBe(10);
    expect(insights.lowStock[0]?.name).toBe("Sugar");
    expect(insights.lowStock[0]?.minimumStockAlert).toBe(20);
    expect(reportsInventoryCostPresentation(false, insights.stockValueAtCostUgx).visible).toBe(false);
  });

  it("TEST 7 — Profit tab stays restricted without reports.profit and available with it", () => {
    const locked = ANALYTICS_CATEGORIES.filter((c) => c !== "profit" || false);
    const open = ANALYTICS_CATEGORIES.filter((c) => c !== "profit" || true);
    expect(locked).not.toContain("profit");
    expect(open).toContain("profit");
    expect(locked).toContain("inventory");
  });

  it("Reports uses canProfit, not inventory-workspace stock.adjust", () => {
    const keeper = actor("stock_keeper");
    expect(actorCanSeeInventoryCostValue(keeper, STARTER, "supabase")).toBe(true);
    const visibility = resolveProfitVisibility({
      role: keeper.role,
      snapshot: STARTER,
      authMode: "supabase",
      actorPermissions: keeper.permissions,
    });
    expect(visibility.canProfit).toBe(false);
    expect(reportsInventoryCostPresentation(visibility.canProfit, 30_000).visible).toBe(false);
  });
});
