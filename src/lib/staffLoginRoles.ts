import type { UserRole } from "../types";

/** Roles shown on the staff login screen only (never owner or supervisor). */
export type StaffLoginRole = Exclude<UserRole, "owner" | "supervisor">;

export const STAFF_LOGIN_ROLES: StaffLoginRole[] = ["cashier", "manager", "stock_keeper"];

const STAFF_LOGIN_ROLE_LABELS: Record<StaffLoginRole, string> = {
  cashier: "Cashier",
  manager: "Manager",
  stock_keeper: "Stock Keeper",
};

export function isStaffLoginRole(value: string): value is StaffLoginRole {
  return (STAFF_LOGIN_ROLES as string[]).includes(value);
}

export function staffLoginRoleLabel(role: StaffLoginRole): string {
  return STAFF_LOGIN_ROLE_LABELS[role];
}

/** Map legacy stored roles (e.g. manager used for supervisor) when matching credentials. */
export function staffLoginRoleMatches(stored: UserRole, selected: StaffLoginRole): boolean {
  return stored === selected;
}
