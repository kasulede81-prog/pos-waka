import type { UserRole } from "../types";
import { canSeeFinanceDiagnostics, canSeeShopWideFinancialSummaries } from "./financeVisibility";
import { hasEffectivePermission, type SubscriptionSnapshot } from "./subscriptionEntitlements";

export type ProfitVisibility = {
  /** Gross / net profit in reports, receipts, exports, owner widgets. */
  canProfit: boolean;
  /** Shop-wide revenue, debt, and profit summaries (not personal cashier totals). */
  canShopWideFinancials: boolean;
  /** Owner-only finance diagnostics surfaces. */
  canFinanceDiagnostics: boolean;
};

/** Single source of truth for profit and shop-wide financial visibility. */
export function resolveProfitVisibility(input: {
  role: UserRole;
  snapshot: SubscriptionSnapshot;
  authMode: "supabase" | "local";
}): ProfitVisibility {
  const canProfit = hasEffectivePermission(input.role, "reports.profit", input.snapshot, input.authMode);
  return {
    canProfit,
    canShopWideFinancials: canSeeShopWideFinancialSummaries(input.role),
    canFinanceDiagnostics: canSeeFinanceDiagnostics(input.role),
  };
}
