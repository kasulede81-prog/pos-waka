import type { ReturnRecord, Sale, UserRole } from "../types";

export type HomeMetricScope = "shop_wide" | "personal" | "inventory";

export type VisibleHomeMetrics = {
  scope: HomeMetricScope;
  showShopWideRevenue: boolean;
  showPersonalRevenue: boolean;
  showInventoryMetrics: boolean;
  showShopWideDebt: boolean;
  showWeekCashSummary: boolean;
  showFastMovers: boolean;
  showRecentSalesList: boolean;
};

const SHOP_WIDE_ROLES = new Set<UserRole>(["owner", "manager", "supervisor"]);
const PERSONAL_ROLES = new Set<UserRole>(["cashier", "waiter"]);

/** Role-based metric scoping for home / dashboard launcher summaries. */
export function resolveVisibleHomeMetrics(role: UserRole): VisibleHomeMetrics {
  if (SHOP_WIDE_ROLES.has(role)) {
    return {
      scope: "shop_wide",
      showShopWideRevenue: true,
      showPersonalRevenue: false,
      showInventoryMetrics: true,
      showShopWideDebt: true,
      showWeekCashSummary: true,
      showFastMovers: true,
      showRecentSalesList: true,
    };
  }
  if (PERSONAL_ROLES.has(role)) {
    return {
      scope: "personal",
      showShopWideRevenue: false,
      showPersonalRevenue: true,
      showInventoryMetrics: false,
      showShopWideDebt: false,
      showWeekCashSummary: false,
      showFastMovers: false,
      showRecentSalesList: true,
    };
  }
  if (role === "stock_keeper") {
    return {
      scope: "inventory",
      showShopWideRevenue: false,
      showPersonalRevenue: false,
      showInventoryMetrics: true,
      showShopWideDebt: false,
      showWeekCashSummary: false,
      showFastMovers: false,
      showRecentSalesList: false,
    };
  }
  return {
    scope: "personal",
    showShopWideRevenue: false,
    showPersonalRevenue: false,
    showInventoryMetrics: false,
    showShopWideDebt: false,
    showWeekCashSummary: false,
    showFastMovers: false,
    showRecentSalesList: false,
  };
}

export function filterSalesForHomeScope(
  sales: Sale[],
  scope: HomeMetricScope,
  actorUserId: string | null | undefined,
): Sale[] {
  if (scope === "shop_wide") return sales;
  if (scope === "inventory") return [];
  if (!actorUserId) return [];
  return sales.filter((s) => s.soldByUserId === actorUserId);
}

export function filterReturnsForHomeScope(
  returns: ReturnRecord[],
  sales: Sale[],
  scope: HomeMetricScope,
  actorUserId: string | null | undefined,
): ReturnRecord[] {
  if (scope === "shop_wide") return returns;
  if (scope === "inventory") return [];
  if (!actorUserId) return [];
  const personalSaleIds = new Set(
    sales.filter((s) => s.soldByUserId === actorUserId).map((s) => s.id),
  );
  return returns.filter(
    (r) => (r.saleId && personalSaleIds.has(r.saleId)) || r.actorUserId === actorUserId,
  );
}
