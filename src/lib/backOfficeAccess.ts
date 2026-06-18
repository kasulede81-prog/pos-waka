import type { Permission, UserRole } from "../types";
import {
  debtPathPermission,
  isStockKeeperPath,
  stockKeeperPathPermission,
} from "./backOfficePaths";
import { hasEffectivePermission, type SubscriptionSnapshot } from "./subscriptionEntitlements";

/** Effective-permission check for Back Office shell routes (matches BackOfficeRouteGuard). */
export function hasBackOfficeShellAccess(input: {
  pathname: string;
  role: UserRole;
  snapshot: SubscriptionSnapshot;
  authMode: "supabase" | "local";
}): boolean {
  const can = (perm: Permission) => hasEffectivePermission(input.role, perm, input.snapshot, input.authMode);
  const stockPerm = isStockKeeperPath(input.pathname) ? stockKeeperPathPermission(input.pathname) : null;
  const debtPerm = debtPathPermission(input.pathname);
  const hasStockKeeperAccess = stockPerm != null && can(stockPerm);
  const hasDebtAccess = debtPerm != null && can(debtPerm);
  const hasFullBackOffice = can("back_office.access");
  return hasFullBackOffice || hasStockKeeperAccess || hasDebtAccess;
}
