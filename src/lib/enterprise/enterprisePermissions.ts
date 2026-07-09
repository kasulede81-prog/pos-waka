import type { Permission, UserRole } from "../../types";
import type { EnterpriseRoleLabel } from "../../types/enterprise";
import { hasActorPermission } from "../permissions";

/** Maps commercial enterprise role labels to existing POS roles (backward compatible). */
export const ENTERPRISE_ROLE_TO_POS: Record<EnterpriseRoleLabel, UserRole> = {
  owner: "owner",
  enterprise_administrator: "owner",
  regional_manager: "supervisor",
  branch_manager: "manager",
  supervisor: "supervisor",
  cashier: "cashier",
  pharmacist: "manager",
  assistant_pharmacist: "cashier",
  restaurant_manager: "manager",
  kitchen_manager: "kitchen",
  bar_manager: "bar",
  inventory_manager: "stock_keeper",
  auditor: "stock_keeper",
  read_only: "stock_keeper",
  inspector: "stock_keeper",
};

export const ENTERPRISE_PERMISSIONS = [
  "enterprise.access",
  "enterprise.branches",
  "enterprise.dashboard",
  "enterprise.transfers",
  "enterprise.purchasing",
  "enterprise.reports",
  "enterprise.audit",
  "enterprise.backup",
  "enterprise.health",
] as const;

export type EnterprisePermission = (typeof ENTERPRISE_PERMISSIONS)[number];

/** Permission inheritance: enterprise capabilities extend module permissions without replacing them. */
export function enterprisePermissionsForRole(
  role: UserRole,
  actorPermissions?: Permission[] | null,
): Permission[] {
  const base: Permission[] = [];
  const has = (perm: Permission) => hasActorPermission(role, perm, actorPermissions);
  if (has("owner.dashboard") || has("enterprise.access")) {
    base.push(
      "enterprise.access",
      "enterprise.dashboard",
      "enterprise.reports",
      "enterprise.audit",
    );
  }
  if (has("enterprise.branches") || has("owner.dashboard") || has("back_office.access")) {
    base.push("enterprise.branches", "enterprise.transfers", "enterprise.purchasing");
  }
  if (has("enterprise.backup") || has("settings.shop")) {
    base.push("enterprise.backup", "enterprise.health");
  }
  return base;
}

export function hasEnterprisePermission(
  role: UserRole,
  perm: EnterprisePermission,
  actorPermissions?: Permission[] | null,
): boolean {
  return enterprisePermissionsForRole(role, actorPermissions).includes(perm as Permission);
}

export function resolveEnterpriseRoleLabel(role: UserRole): EnterpriseRoleLabel {
  if (role === "owner") return "owner";
  if (role === "manager") return "branch_manager";
  if (role === "supervisor") return "regional_manager";
  if (role === "cashier") return "cashier";
  if (role === "stock_keeper") return "inventory_manager";
  if (role === "kitchen") return "kitchen_manager";
  if (role === "bar") return "bar_manager";
  return "read_only";
}
