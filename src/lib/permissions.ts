import type { Permission, UserRole } from "../types";
import { appendPilotEvent } from "./pilotEventLog";

/**
 * Role source of truth on the client:
 * - Local/offline sign-in: **owner** (single-device shop).
 * - Supabase: **shop_members** row only — no metadata fallback, no default owner.
 */
const ALL_ROLES: UserRole[] = ["owner", "manager", "cashier", "stock_keeper", "supervisor", "waiter"];

/** Lowest-privilege role when Supabase membership cannot be resolved. */
export const FAIL_CLOSED_ROLE: UserRole = "waiter";

function isUserRole(v: string): v is UserRole {
  return (ALL_ROLES as string[]).includes(v);
}

/** Normalize legacy / mistyped role strings to a canonical `UserRole`. */
export function normalizeUserRole(raw: unknown): UserRole | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const n = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!n) return null;
  if (n === "viewer") return "stock_keeper"; // legacy DB shop_members label
  if (n === "store_keeper" || n === "storekeeper") return "stock_keeper";
  if (n === "manage" || n === "management" || n === "mngr" || n === "shop_manager") return "manager";
  return isUserRole(n) ? n : null;
}

export function parseRoleFromUserMetadata(meta: Record<string, unknown> | undefined): UserRole | null {
  if (!meta) return null;
  const raw = meta.pos_role ?? meta.role;
  return normalizeUserRole(raw);
}

export function logRoleResolutionFailure(details: Record<string, string | boolean | null>): void {
  appendPilotEvent("other", "Auth role fail-closed (no valid shop_members)", details);
}

export function resolveAuthRole(params: {
  mode: "supabase" | "local";
  userMetadata: Record<string, unknown> | undefined;
  /** Authoritative when present — from `shop_members` on the primary shop. */
  shopMemberRole?: UserRole | null;
}): UserRole {
  if (params.mode === "local") return "owner";
  if (params.shopMemberRole) return params.shopMemberRole;
  logRoleResolutionFailure({
    hadMetadataRole: parseRoleFromUserMetadata(params.userMetadata) != null,
  });
  return FAIL_CLOSED_ROLE;
}

/** Bump when the permission matrix changes (clears client cache). */
const PERM_MATRIX_VERSION = 13;

const HOSPITALITY_OWNER: Permission[] = [
  "hospitality.floor",
  "hospitality.order",
  "hospitality.settle",
  "hospitality.transfer",
  "hospitality.kitchen",
  "pending_sales.manage",
];

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: [
    "pos.sell",
    "sale_void",
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
    "settings.receipt",
    "settings.devices",
    "owner.dashboard",
    "owner.activity",
    "owner.cash_history",
    "nav.office",
    "ui.toggle_mode",
    "suppliers.view",
    "suppliers.manage",
    "purchases.record",
    "purchases.view",
    "pharmacy.expired_writeoff",
    "expenses.record",
    "expenses.edit",
    "expenses.delete",
    ...HOSPITALITY_OWNER,
  ],
  manager: [
    "pos.sell",
    "sale_void",
    "back_office.access",
    "receipts.view",
    "stock.view",
    "stock.adjust",
    "products.add",
    "products.edit_presets",
    "customers.view",
    "customers.debt",
    "day.close",
    "reports.view",
    "reports.profit",
    "settings.view",
    "settings.receipt",
    "owner.activity",
    "nav.office",
    "ui.toggle_mode",
    "suppliers.view",
    "suppliers.manage",
    "purchases.record",
    "purchases.view",
    "pharmacy.expired_writeoff",
    "expenses.record",
    "expenses.edit",
    "expenses.delete",
    ...HOSPITALITY_OWNER,
  ],
  /** Sell-first: can sell, void, receipts, and record drawer expenses. */
  cashier: [
    "pos.sell",
    "sale_void",
    "receipts.view",
    "customers.view",
    "expenses.record",
    "hospitality.floor",
    "hospitality.order",
    "hospitality.settle",
    "hospitality.transfer",
    "pending_sales.manage",
  ],
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
  /** Floor supervisor — same operational access as manager on device. */
  supervisor: [
    "pos.sell",
    "sale_void",
    "back_office.access",
    "receipts.view",
    "stock.view",
    "stock.adjust",
    "products.add",
    "products.edit_presets",
    "customers.view",
    "customers.debt",
    "day.close",
    "reports.view",
    "reports.profit",
    "settings.view",
    "settings.receipt",
    "owner.activity",
    "nav.office",
    "ui.toggle_mode",
    "suppliers.view",
    "suppliers.manage",
    "purchases.record",
    "purchases.view",
    "expenses.record",
    "expenses.edit",
    ...HOSPITALITY_OWNER,
  ],
  /** Table service — order and settle assigned tables; no back office. */
  waiter: [
    "pos.sell",
    "receipts.view",
    "hospitality.floor",
    "hospitality.order",
    "hospitality.settle",
    "pending_sales.manage",
  ],
};

const cache = new Map<string, Set<Permission>>();

function permSet(role: UserRole): Set<Permission> {
  const key = `${PERM_MATRIX_VERSION}:${role}`;
  if (!cache.has(key)) {
    cache.set(key, new Set(ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.cashier));
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
  return role === "owner" || role === "manager" || role === "supervisor";
}
