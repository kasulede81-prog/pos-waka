import type { Permission, UserRole } from "../types";
import { hasActorPermission } from "./permissions";

/** Shop-wide summary metrics (stock value at cost, shop expenses, total receivables, profit). */
export function canSeeShopWideFinancialSummaries(
  role: UserRole,
  actorPermissions?: Permission[] | null,
): boolean {
  return hasActorPermission(role, "reports.profit", actorPermissions);
}

/** Owner-only finance diagnostics and margin analytics. */
export function canSeeFinanceDiagnostics(
  role: UserRole,
  actorPermissions?: Permission[] | null,
): boolean {
  return hasActorPermission(role, "owner.dashboard", actorPermissions);
}
