/**
 * Data access and pure validation for the admin subscription discount window.
 *
 * TWO KINDS OF DISCOUNT, and the difference is the whole point of the screen:
 *
 *   GLOBAL    one rule per plan (`admin_plan_discounts`, migration
 *             20261010120000). Applies to every account on that plan that has no
 *             individual discount of its own.
 *   INDIVIDUAL one rule per account (`subscriptions.admin_discount_percent`).
 *             WINS OUTRIGHT over a global rule. It is never added to one.
 *
 * Neither is a pricing-campaign discount: campaigns live in the Pricing Campaigns
 * window, are bounded at 90% with a UGX 5,000 floor, and are a different
 * mechanism. Nothing here changes them.
 *
 * Prices shown by this module are NOT computed here. `preview` calls the server,
 * which calls the same `subscription_payment_plan_amount` checkout uses, so what
 * an admin sees in the preview cannot drift from what a shop is charged. The
 * local helpers below exist only to validate input before it is sent.
 */
import { supabase } from "./supabase";

/** The system maximum. Enforced by the table CHECK, both RPCs, and this module. */
export const MAX_ADMIN_DISCOUNT_PERCENT = 99;

export type PlanCode = "starter" | "business" | "waka_plus";

export const ADMIN_DISCOUNT_PLANS: readonly PlanCode[] = ["starter", "business", "waka_plus"];

export const ADMIN_DISCOUNT_PLAN_LABELS: Record<PlanCode, string> = {
  starter: "Starter",
  business: "Business",
  waka_plus: "DKASU Plus",
};

export type RpcResult = { ok: true; computed?: Record<string, unknown> } | { ok: false; error: string };

export type AdminDiscountFetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Pure validation — unit-tested in `adminSubscriptionDiscounts.test.ts`
// ---------------------------------------------------------------------------

export type DiscountDraftErrors = {
  percent?: string;
  window?: string;
  start?: string;
  expiry?: string;
};

/**
 * Parses the raw input string. Empty is NOT zero: clearing the field is a
 * mistake to be corrected, while typing `0` is a deliberate "no discount".
 */
export function parseDiscountPercent(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Enter a discount percentage." };

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, error: "Enter a number." };
  if (value < 0) return { ok: false, error: "A discount cannot be negative." };
  if (value > MAX_ADMIN_DISCOUNT_PERCENT) {
    return { ok: false, error: `The maximum discount is ${MAX_ADMIN_DISCOUNT_PERCENT}%.` };
  }
  return { ok: true, value };
}

/**
 * Windows are optional and open-ended in both directions. An inverted window is
 * rejected here as well as server-side, so the admin sees which field is wrong
 * rather than a raw constraint error.
 */
export function validateDiscountDraft(input: {
  percentRaw: string;
  startsAt?: string | null;
  expiresAt?: string | null;
}): DiscountDraftErrors {
  const errors: DiscountDraftErrors = {};

  const percent = parseDiscountPercent(input.percentRaw);
  if (!percent.ok) errors.percent = percent.error;

  const start = input.startsAt ? Date.parse(input.startsAt) : null;
  const expiry = input.expiresAt ? Date.parse(input.expiresAt) : null;

  if (start !== null && Number.isNaN(start)) errors.start = "Enter a valid start date.";
  if (expiry !== null && Number.isNaN(expiry)) errors.expiry = "Enter a valid expiry date.";

  if (
    start !== null &&
    expiry !== null &&
    !Number.isNaN(start) &&
    !Number.isNaN(expiry) &&
    expiry <= start
  ) {
    errors.window = "The expiry must be after the start.";
  }

  return errors;
}

export function hasDiscountErrors(errors: DiscountDraftErrors): boolean {
  return Object.values(errors).some((v) => typeof v === "string" && v.length > 0);
}

/**
 * A LOCAL arithmetic preview, used only to render something while the server
 * preview is in flight and to sanity-check it when it lands. It is rounded the
 * same way the server is — `round(amount × (100 − pct) / 100)` — but it is not
 * authoritative and is never shown as the final word.
 */
export function localDiscountPreview(
  originalUgx: number,
  percent: number,
): { discountUgx: number; finalUgx: number } {
  const finalUgx = Math.max(0, Math.round((originalUgx * (100 - percent)) / 100));
  return { discountUgx: Math.max(0, originalUgx - finalUgx), finalUgx };
}

/** What the admin typed, as the server expects it. */
export function normalizeDiscountPercent(percent: number): number {
  return Math.min(Math.max(percent, 0), MAX_ADMIN_DISCOUNT_PERCENT);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminDiscountPlan = {
  plan_code: string;
  monthly_ugx: number;
  annual_full_ugx: number;
};

export type AdminPlanDiscount = {
  plan_code: string;
  discount_percent: number;
  active: boolean;
  starts_at: string | null;
  expires_at: string | null;
  reason: string | null;
  is_active_now: boolean;
  created_at: string | null;
  updated_at: string | null;
  base_monthly_ugx: number;
  final_monthly_ugx: number;
  final_monthly_with_discount_ugx: number;
};

export type AdminIndividualDiscount = {
  subscription_id: string;
  organization_id: string | null;
  shop_id: string | null;
  account_name: string;
  plan_code: string | null;
  /** The rate as configured. May not be in force — see `effective_percent`. */
  discount_percent: number;
  note: string | null;
  updated_at: string | null;
  starts_at: string | null;
  expires_at: string | null;
  /** What the server resolves the discount to be RIGHT NOW (0 once lapsed). */
  effective_percent: number;
  is_active_now: boolean;
  final_monthly_ugx: number | null;
  final_annual_ugx: number | null;
};

export type AdminDiscountOverview = {
  plans: AdminDiscountPlan[];
  global: AdminPlanDiscount[];
  individual: AdminIndividualDiscount[];
};

export type AdminDiscountPreview = {
  plan_code: string;
  discount_percent: number;
  base_monthly_ugx: number;
  base_annual_ugx: number;
  monthly_ugx: number;
  annual_ugx: number;
  monthly_discount_ugx: number;
  annual_discount_ugx: number;
};

// ---------------------------------------------------------------------------
// RPC access
// ---------------------------------------------------------------------------

type RpcEnvelope = { ok?: boolean; error?: string };

/**
 * A raw Postgres code is never shown to an admin. `forbidden` in particular can
 * arrive as a raised exception (the RPCs `raise` rather than return it), and
 * "permission denied" should read as a permissions problem, not a crash.
 */
export function mapDiscountError(message: string): string {
  const raw = (message ?? "").trim();
  const lower = raw.toLowerCase();

  if (lower.includes("forbidden") || lower.includes("permission denied")) {
    return "You do not have permission to change subscription discounts.";
  }
  if (lower.includes("pgrst202") || lower.includes("could not find the function")) {
    return "Discount management is not available on this deployment yet.";
  }
  if (!raw) return "The request failed.";
  return raw;
}

function unwrap(data: unknown, error: { message: string } | null): RpcEnvelope & Record<string, unknown> {
  if (error) return { ok: false, error: mapDiscountError(error.message) };
  return (data ?? {}) as RpcEnvelope & Record<string, unknown>;
}

export async function fetchAdminDiscountOverview(): Promise<AdminDiscountFetchResult<AdminDiscountOverview>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("admin_discount_overview");
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: envelope.error ?? "The discount overview could not be loaded." };
  }

  const raw = envelope as unknown as AdminDiscountOverview;
  return {
    ok: true,
    data: {
      plans: Array.isArray(raw.plans) ? raw.plans : [],
      global: Array.isArray(raw.global) ? raw.global : [],
      individual: Array.isArray(raw.individual) ? raw.individual : [],
    },
  };
}

export async function previewAdminDiscount(input: {
  planCode: string;
  discountPercent: number;
  individual: boolean;
}): Promise<AdminDiscountFetchResult<AdminDiscountPreview>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("admin_discount_preview", {
    p_plan_code: input.planCode,
    p_discount_percent: normalizeDiscountPercent(input.discountPercent),
    p_individual: input.individual,
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: envelope.error ?? "The preview could not be calculated." };
  }
  return { ok: true, data: envelope as unknown as AdminDiscountPreview };
}

export async function saveAdminPlanDiscount(input: {
  planCode: string;
  discountPercent: number;
  active: boolean;
  startsAt?: string | null;
  expiresAt?: string | null;
  reason?: string | null;
}): Promise<RpcResult> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("admin_plan_discount_save", {
    p_plan_code: input.planCode,
    p_discount_percent: normalizeDiscountPercent(input.discountPercent),
    p_active: input.active,
    p_starts_at: input.startsAt ?? null,
    p_expires_at: input.expiresAt ?? null,
    p_reason: input.reason?.trim() ? input.reason.trim() : null,
  });
  const envelope = unwrap(data, error);
  return envelope.ok === true
    ? { ok: true, computed: envelope as Record<string, unknown> }
    : { ok: false, error: envelope.error ?? "The global discount could not be saved." };
}

export async function deleteAdminPlanDiscount(planCode: string): Promise<RpcResult> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("admin_plan_discount_delete", { p_plan_code: planCode });
  const envelope = unwrap(data, error);
  return envelope.ok === true
    ? { ok: true }
    : { ok: false, error: envelope.error ?? "The global discount could not be removed." };
}

/**
 * Sets — or clears — one account's discount. A percentage of 0 clears it, which
 * is also what removes the note; there is no separate "deactivate".
 *
 * The target is a SHOP, because that is what an admin picks. The server resolves
 * that shop to its organization's newest subscription itself, so this cannot be
 * pointed at another tenant's row from the client.
 */
export async function saveAdminSubscriptionDiscount(input: {
  shopId: string;
  discountPercent: number;
  reason?: string | null;
  /** Optional window. Enforced by the server on every money path, not here. */
  startsAt?: string | null;
  expiresAt?: string | null;
}): Promise<RpcResult> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("admin_subscription_discount_save", {
    p_shop_id: input.shopId,
    p_discount_percent: normalizeDiscountPercent(input.discountPercent),
    p_reason: input.reason?.trim() ? input.reason.trim() : null,
    p_starts_at: input.startsAt ?? null,
    p_expires_at: input.expiresAt ?? null,
  });
  const envelope = unwrap(data, error);
  return envelope.ok === true
    ? { ok: true, computed: envelope as Record<string, unknown> }
    : { ok: false, error: envelope.error ?? "The account discount could not be saved." };
}
