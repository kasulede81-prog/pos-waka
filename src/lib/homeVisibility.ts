import type { ReturnRecord, Sale, UserRole } from "../types";
import { saleSoldByMatchesActor, type SellerMatchActor } from "./sellerIdentity";

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
  actor: SellerMatchActor | string | null | undefined,
): Sale[] {
  if (scope === "shop_wide") return sales;
  if (scope === "inventory") return [];
  const matchActor =
    typeof actor === "string" ? { userId: actor } : actor ?? null;
  if (!matchActor?.userId) return [];
  return sales.filter((s) => saleSoldByMatchesActor(s, matchActor));
}

export function filterReturnsForHomeScope(
  returns: ReturnRecord[],
  sales: Sale[],
  scope: HomeMetricScope,
  actor: SellerMatchActor | string | null | undefined,
): ReturnRecord[] {
  if (scope === "shop_wide") return returns;
  if (scope === "inventory") return [];
  const matchActor =
    typeof actor === "string" ? { userId: actor } : actor ?? null;
  if (!matchActor?.userId) return [];
  const personalSaleIds = new Set(
    sales.filter((s) => saleSoldByMatchesActor(s, matchActor)).map((s) => s.id),
  );
  return returns.filter(
    (r) =>
      (r.saleId && personalSaleIds.has(r.saleId)) || r.actorUserId === matchActor.userId,
  );
}
