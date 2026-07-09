import type { CustomStaffRole, Permission, StaffAccount, UserRole } from "../../types";
import { permissionsForRole } from "../permissions";

export function buildCustomRolePermissions(
  inheritsFrom: UserRole,
  granted: Permission[],
  revoked: Permission[] = [],
): Permission[] {
  const set = new Set(permissionsForRole(inheritsFrom));
  for (const p of granted) set.add(p);
  for (const p of revoked) set.delete(p);
  return [...set];
}

export function resolveStaffPermissions(
  staff: Pick<StaffAccount, "role" | "permissions" | "customRoleId">,
  customRoles: CustomStaffRole[] | null | undefined,
): Permission[] {
  if (staff.customRoleId && customRoles?.length) {
    const custom = customRoles.find((r) => r.id === staff.customRoleId);
    const status = custom?.status ?? "active";
    if (custom && status === "active" && custom.permissions?.length) return [...custom.permissions];
  }
  if (staff.permissions?.length) return [...staff.permissions];
  return permissionsForRole(staff.role);
}

export function staffHasPermission(
  staff: Pick<StaffAccount, "role" | "permissions" | "customRoleId">,
  permission: Permission,
  customRoles?: CustomStaffRole[] | null,
): boolean {
  return resolveStaffPermissions(staff, customRoles).includes(permission);
}
