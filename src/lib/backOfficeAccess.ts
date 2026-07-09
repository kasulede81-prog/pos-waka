import type { Permission, UserRole } from "../types";
import {
  debtPathPermission,
  isStockKeeperPath,
  stockKeeperPathPermission,
} from "./backOfficePaths";
import { permissionsHasEffective } from "./actorAuthorization";
import type { SubscriptionSnapshot } from "./subscriptionEntitlements";

/** Effective-permission check for Back Office shell routes (matches BackOfficeRouteGuard). */
export function hasBackOfficeShellAccess(input: {
  pathname: string;
  role: UserRole;
  snapshot: SubscriptionSnapshot;
  authMode: "supabase" | "local";
  actorPermissions?: Permission[] | null;
}): boolean {
  const can = (perm: Permission) =>
    permissionsHasEffective(input.role, perm, input.snapshot, input.authMode, input.actorPermissions);
  const stockPerm = isStockKeeperPath(input.pathname) ? stockKeeperPathPermission(input.pathname) : null;
  const debtPerm = debtPathPermission(input.pathname);
  const hasStockKeeperAccess = stockPerm != null && can(stockPerm);
  const hasDebtAccess = debtPerm != null && can(debtPerm);
  const hasFullBackOffice = can("back_office.access");
  return hasFullBackOffice || hasStockKeeperAccess || hasDebtAccess;
}
