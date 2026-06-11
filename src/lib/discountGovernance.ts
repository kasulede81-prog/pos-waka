import type { ShopPreferences, UserRole } from "../types";

export type DiscountControlMode = "unrestricted" | "manager_approval" | "max_percent";

const MANAGER_ROLES: UserRole[] = ["owner", "manager"];

export function resolveDiscountControlMode(prefs: ShopPreferences): DiscountControlMode {
  const mode = prefs.discountControlMode;
  if (mode === "manager_approval" || mode === "max_percent") return mode;
  return "unrestricted";
}

export function resolveDiscountMaxPercent(prefs: ShopPreferences): number {
  const n = prefs.discountMaxPercentThreshold;
  if (typeof n === "number" && n >= 0 && n <= 100) return n;
  return 10;
}

export function discountPercentOfSubtotal(discountUgx: number, subtotalUgx: number): number {
  if (subtotalUgx <= 0) return 0;
  return (Math.max(0, discountUgx) / subtotalUgx) * 100;
}

export function canRoleBypassDiscountApproval(role: UserRole): boolean {
  return MANAGER_ROLES.includes(role);
}

export function validateCombinedDraftDiscount(opts: {
  prefs: ShopPreferences;
  role: UserRole;
  listSubtotalUgx: number;
  lineDiscountUgx: number;
  cartDiscountUgx: number;
}): { ok: true } | { ok: false; errorKey: string } {
  const totalDiscount = Math.max(0, opts.lineDiscountUgx) + Math.max(0, opts.cartDiscountUgx);
  return validateDraftDiscount({
    prefs: opts.prefs,
    role: opts.role,
    discountUgx: totalDiscount,
    lineSubtotalUgx: opts.listSubtotalUgx,
  });
}
export function validateDraftDiscount(opts: {
  prefs: ShopPreferences;
  role: UserRole;
  discountUgx: number;
  lineSubtotalUgx: number;
}): { ok: true } | { ok: false; errorKey: string } {
  const mode = resolveDiscountControlMode(opts.prefs);
  if (mode === "unrestricted") return { ok: true };

  const pct = discountPercentOfSubtotal(opts.discountUgx, opts.lineSubtotalUgx);
  const maxPct = resolveDiscountMaxPercent(opts.prefs);

  if (mode === "max_percent" && pct > maxPct + 1e-6) {
    return { ok: false, errorKey: "discountExceedsMaxPercent" };
  }

  if (mode === "manager_approval" && pct > maxPct + 1e-6 && !canRoleBypassDiscountApproval(opts.role)) {
    return { ok: false, errorKey: "discountManagerApprovalRequired" };
  }

  return { ok: true };
}
