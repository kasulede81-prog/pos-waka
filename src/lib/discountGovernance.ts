import type { RestaurantBillDiscountApproval, ShopPreferences, UserRole } from "../types";

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

/**
 * Does this stored approval authorize EXACTLY this discount on THIS sale? Pure — the financial
 * calculation stays in finalizeDraftSale; an approval only lets the existing policy check pass.
 *
 * It must match the sale it was granted on, the kind it was granted for, and every amount it
 * recorded: line discount, cart discount, their total and the percent of the list subtotal.
 * A 10% approval never covers 20%; UGX 10,000 never covers UGX 50,000.
 */
export function isDiscountApprovalValid(
  approval: RestaurantBillDiscountApproval | null | undefined,
  ctx: {
    saleId: string | null | undefined;
    kind?: "line" | "bill";
    lineDiscountUgx: number;
    cartDiscountUgx: number;
    listSubtotalUgx: number;
  },
): boolean {
  if (!approval || !approval.approvedByUserId) return false;
  if (!ctx.saleId || approval.saleId !== ctx.saleId) return false;
  if (ctx.kind && approval.kind !== ctx.kind) return false;
  const { approvedLineDiscountUgx: line, approvedCartDiscountUgx: cart, approvedDiscountUgx: total, approvedPercent: pct } = approval;
  if ([line, cart, total, pct].some((n) => typeof n !== "number" || !Number.isFinite(n))) return false;
  const lineNow = Math.max(0, ctx.lineDiscountUgx);
  const cartNow = Math.max(0, ctx.cartDiscountUgx);
  const totalNow = lineNow + cartNow;
  if (lineNow > (line as number) + 1e-6) return false;
  if (cartNow > (cart as number) + 1e-6) return false;
  if (totalNow > (total as number) + 1e-6) return false;
  return discountPercentOfSubtotal(totalNow, ctx.listSubtotalUgx) <= (pct as number) + 1e-6;
}

/**
 * validateCombinedDraftDiscount, plus: a valid bound approval satisfies the "manager approval
 * required" rule (and only that rule — the hard max-percent cap is never approvable).
 */
export function validateCombinedDraftDiscountWithApproval(opts: {
  prefs: ShopPreferences;
  role: UserRole;
  listSubtotalUgx: number;
  lineDiscountUgx: number;
  cartDiscountUgx: number;
  approval?: RestaurantBillDiscountApproval | null;
  saleId?: string | null;
  kind?: "line" | "bill";
}): { ok: true } | { ok: false; errorKey: string } {
  const base = validateCombinedDraftDiscount(opts);
  if (base.ok || base.errorKey !== "discountManagerApprovalRequired") return base;
  const approved = isDiscountApprovalValid(opts.approval, {
    saleId: opts.saleId,
    kind: opts.kind,
    lineDiscountUgx: opts.lineDiscountUgx,
    cartDiscountUgx: opts.cartDiscountUgx,
    listSubtotalUgx: opts.listSubtotalUgx,
  });
  return approved ? { ok: true } : base;
}
