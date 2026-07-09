import type { Permission, UserRole } from "../types";
import { canSeeFinanceDiagnostics, canSeeShopWideFinancialSummaries } from "./financeVisibility";
import { permissionsHasEffective } from "./actorAuthorization";
import type { SubscriptionSnapshot } from "./subscriptionEntitlements";
import { hasActorPermission } from "./permissions";

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
  actorPermissions?: Permission[] | null;
}): ProfitVisibility {
  const canProfit = permissionsHasEffective(
    input.role,
    "reports.profit",
    input.snapshot,
    input.authMode,
    input.actorPermissions,
  );
  return {
    canProfit,
    canShopWideFinancials: canSeeShopWideFinancialSummaries(input.role, input.actorPermissions),
    canFinanceDiagnostics: canSeeFinanceDiagnostics(input.role, input.actorPermissions),
  };
}

/** Session actor wrapper — prefer in UI and hooks. */
export function resolveActorProfitVisibility(input: {
  role: UserRole;
  permissions?: Permission[] | null;
  snapshot: SubscriptionSnapshot;
  authMode: "supabase" | "local";
}): ProfitVisibility {
  return resolveProfitVisibility({
    role: input.role,
    snapshot: input.snapshot,
    authMode: input.authMode,
    actorPermissions: input.permissions,
  });
}

/** Tier-unaware profit gate from permission snapshot (custom roles). */
export function actorCanSeeProfit(
  role: UserRole,
  actorPermissions?: import("../types").Permission[] | null,
): boolean {
  return hasActorPermission(role, "reports.profit", actorPermissions);
}
