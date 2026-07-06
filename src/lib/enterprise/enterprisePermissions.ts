import type { Permission, UserRole } from "../../types";
import type { EnterpriseRoleLabel } from "../../types/enterprise";
import { hasPermission } from "../permissions";

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
export function enterprisePermissionsForRole(role: UserRole): Permission[] {
  const base: Permission[] = [];
  if (hasPermission(role, "owner.dashboard") || role === "owner" || role === "manager" || role === "supervisor") {
    base.push(
      "enterprise.access",
      "enterprise.dashboard",
      "enterprise.reports",
      "enterprise.audit",
    );
  }
  if (role === "owner" || role === "manager" || role === "supervisor") {
    base.push("enterprise.branches", "enterprise.transfers", "enterprise.purchasing");
  }
  if (role === "owner") {
    base.push("enterprise.backup", "enterprise.health");
  }
  return base;
}

export function hasEnterprisePermission(role: UserRole, perm: EnterprisePermission): boolean {
  return enterprisePermissionsForRole(role).includes(perm as Permission);
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
