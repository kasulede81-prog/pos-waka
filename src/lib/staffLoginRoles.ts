import type { UserRole } from "../types";

/** Roles shown on the staff login screen only (never owner or supervisor). */
export type StaffLoginRole = Exclude<UserRole, "owner" | "supervisor">;

export const STAFF_LOGIN_ROLES: StaffLoginRole[] = ["cashier", "manager", "stock_keeper", "waiter"];

const STAFF_LOGIN_ROLE_LABELS: Record<StaffLoginRole, string> = {
  cashier: "Cashier",
  manager: "Manager",
  stock_keeper: "Stock Keeper",
  waiter: "Waiter",
};

export function isStaffLoginRole(value: string): value is StaffLoginRole {
  return (STAFF_LOGIN_ROLES as string[]).includes(value);
}

export function staffLoginRoleLabel(role: StaffLoginRole): string {
  return STAFF_LOGIN_ROLE_LABELS[role];
}

/** Map legacy stored roles (e.g. supervisor stored as manager) when matching credentials. */
export function staffLoginRoleMatches(stored: UserRole, selected: StaffLoginRole): boolean {
  if (stored === selected) return true;
  if (stored === "supervisor" && selected === "manager") return true;
  return false;
}
