import type { Permission, UserRole } from "../types";

/**
 * Role source of truth on the client:
 * - Supabase: `user.user_metadata.pos_role` or `user.user_metadata.role` when set to a known role.
 * - When missing (legacy accounts): treat as **owner** so existing shops keep full access until `shop_members` is wired.
 * - Local/offline sign-in: **owner** (single-device shop).
 * - Constrained accounts: set `pos_role` in Supabase user metadata to `cashier`, `manager`, or `stock_keeper`.
 */
const ALL_ROLES: UserRole[] = ["owner", "manager", "cashier", "stock_keeper"];

function isUserRole(v: string): v is UserRole {
  return (ALL_ROLES as string[]).includes(v);
}

export function parseRoleFromUserMetadata(meta: Record<string, unknown> | undefined): UserRole | null {
  if (!meta) return null;
  const raw = meta.pos_role ?? meta.role;
  if (typeof raw !== "string") return null;
  const n = raw.trim().toLowerCase();
  if (n === "viewer") return "stock_keeper"; // align legacy DB label with client stock role
  return isUserRole(n) ? n : null;
}

export function resolveAuthRole(params: {
  mode: "supabase" | "local";
  userMetadata: Record<string, unknown> | undefined;
}): UserRole {
  if (params.mode === "local") return "owner";
  const parsed = parseRoleFromUserMetadata(params.userMetadata);
  return parsed ?? "owner";
}

/** Bump when the permission matrix changes (clears client cache). */
const PERM_MATRIX_VERSION = 4;

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: [
    "pos.sell",
    "back_office.access",
    "receipts.view",
    "stock.view",
    "stock.adjust",
    "products.add",
    "products.remove",
    "products.edit_presets",
    "customers.view",
    "customers.debt",
    "day.close",
    "reports.view",
    "reports.profit",
    "settings.view",
    "settings.shop",
    "owner.dashboard",
    "owner.activity",
    "owner.cash_history",
    "nav.office",
    "ui.toggle_mode",
    "suppliers.view",
    "suppliers.manage",
    "purchases.record",
    "purchases.view",
  ],
  manager: [
    "pos.sell",
    "back_office.access",
    "receipts.view",
    "stock.view",
    "stock.adjust",
    "products.add",
    "products.edit_presets",
    "customers.view",
    "day.close",
    "reports.view",
    "reports.profit",
    "settings.view",
    "owner.activity",
    "nav.office",
    "ui.toggle_mode",
    "suppliers.view",
    "suppliers.manage",
    "purchases.record",
    "purchases.view",
  ],
  /** Sell-first: can sell, print receipts, returns, and see own receipt history. */
  cashier: ["pos.sell", "receipts.view", "customers.view"],
  stock_keeper: [
    "receipts.view",
    "stock.view",
    "stock.adjust",
    "products.add",
    "products.edit_presets",
    "suppliers.view",
    "suppliers.manage",
    "purchases.record",
    "purchases.view",
  ],
};

const cache = new Map<string, Set<Permission>>();

function permSet(role: UserRole): Set<Permission> {
  const key = `${PERM_MATRIX_VERSION}:${role}`;
  if (!cache.has(key)) {
    cache.set(key, new Set(ROLE_PERMISSIONS[role]));
  }
  return cache.get(key)!;
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return permSet(role).has(permission);
}

export function permissionsForRole(role: UserRole): Permission[] {
  return [...permSet(role)];
}

export function canUseDevRoleSimulator(authResolvedRole: UserRole): boolean {
  return authResolvedRole === "owner";
}

export function canTogglePosUiMode(role: UserRole): boolean {
  return role === "owner" || role === "manager";
}
