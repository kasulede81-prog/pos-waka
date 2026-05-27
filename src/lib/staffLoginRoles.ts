import type { UserRole } from "../types";

/** Roles shown on the staff login screen only (never owner). */
export type StaffLoginRole = Exclude<UserRole, "owner">;

export const STAFF_LOGIN_ROLES: StaffLoginRole[] = ["cashier", "manager", "stock_keeper", "supervisor"];

const STAFF_LOGIN_ROLE_LABELS: Record<StaffLoginRole, string> = {
  cashier: "Cashier",
  manager: "Manager",
  stock_keeper: "Stock Keeper",
  supervisor: "Supervisor",
};

export function isStaffLoginRole(value: string): value is StaffLoginRole {
  return (STAFF_LOGIN_ROLES as string[]).includes(value);
}

export function staffLoginRoleLabel(role: StaffLoginRole): string {
  return STAFF_LOGIN_ROLE_LABELS[role];
}

/** Map legacy stored roles (e.g. manager used for supervisor) when matching credentials. */
export function staffLoginRoleMatches(stored: UserRole, selected: StaffLoginRole): boolean {
  if (stored === selected) return true;
  if (selected === "supervisor" && stored === "manager") return true;
  return false;
}
