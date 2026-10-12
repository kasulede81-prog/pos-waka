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
 * EACH KIND HAS TWO LEGS, ONE PER BILLING INTERVAL (migration 20261012100000).
 * `discount_percent` / `admin_discount_percent` is the MONTHLY leg and
 * `annual_discount_percent` / `admin_discount_percent_annual` is the ANNUAL one.
 * The two are independent by construction: a monthly rule never moves a yearly
 * price and an annual rule never moves a monthly one, so the screen edits them
 * separately and previews them separately. The window is shared by both legs.
 *
 * Where a leg is left unset the resolver falls back PER INTERVAL: a zero on the
 * monthly leg means "no individual monthly rule", so the plan's global MONTHLY
 * rule applies, and the annual leg answers for itself.
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

/**
 * The same three labels the Pricing Campaigns window uses (`PLAN_LABELS` in
 * `pricingCampaigns.ts`). Two adjacent admin screens naming one plan two
 * different ways is how an operator ends up discounting the wrong plan.
 */
export const ADMIN_DISCOUNT_PLAN_LABELS: Record<PlanCode, string> = {
  starter: "Starter",
  business: "Business",
  waka_plus: "Enterprise (Waka Plus)",
};

export type RpcResult = { ok: true; computed?: Record<string, unknown> } | { ok: false; error: string };

export type AdminDiscountFetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Pure validation — unit-tested in `adminSubscriptionDiscounts.test.ts`
// ---------------------------------------------------------------------------

export type DiscountDraftErrors = {
  percent?: string;
  /** The annual leg. Omitted entirely when the screen has no annual field. */
  annualPercent?: string;
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
  /** The annual leg. Absent means this screen does not edit one. */
  annualPercentRaw?: string;
  startsAt?: string | null;
  expiresAt?: string | null;
}): DiscountDraftErrors {
  const errors: DiscountDraftErrors = {};

  const percent = parseDiscountPercent(input.percentRaw);
  if (!percent.ok) errors.percent = percent.error;

  // The same bound as the monthly leg, and the same function, so the two fields
  // cannot be validated differently by accident.
  if (input.annualPercentRaw !== undefined) {
    const annual = parseDiscountPercent(input.annualPercentRaw);
    if (!annual.ok) errors.annualPercent = annual.error;
  }

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
  /** The MONTHLY leg, 0–99. Independent of the annual leg. */
  discount_percent: number;
  /** The ANNUAL leg, 0–99. Independent of the monthly leg. */
  annual_discount_percent: number;
  active: boolean;
  starts_at: string | null;
  expires_at: string | null;
  reason: string | null;
  /** True only while the rule is enabled, non-zero and inside its window. */
  is_active_now: boolean;
  /** The same fact under the name the table column uses. */
  applies_now?: boolean;
  created_at: string | null;
  updated_at: string | null;
  /** The campaign-layer prices: the plan with NO admin discount at all. */
  base_monthly_ugx: number;
  base_annual_ugx?: number;
  /**
   * What a shop with no account discount pays RIGHT NOW, per interval. With the
   * leg not in force this is the campaign price — it is what checkout would
   * charge, so the screen shows THIS as the effective price.
   */
  effective_monthly_ugx?: number;
  effective_annual_ugx?: number;
  /** What each leg would be worth IF it were in force. Never the current price. */
  configured_monthly_ugx?: number;
  configured_annual_ugx?: number;
  /** Historical names, kept: the server now returns the live-aware price in them. */
  final_monthly_ugx: number;
  final_monthly_with_discount_ugx: number;
  final_annual_ugx?: number;
};

export type AdminIndividualDiscount = {
  subscription_id: string;
  organization_id: string | null;
  shop_id: string | null;
  /** Always "organization" — a discount is stored on the account's subscription. */
  scope?: string;
  /** How many shops share that subscription, i.e. how many the discount covers. */
  shop_count?: number;
  account_name: string;
  plan_code: string | null;
  /** The MONTHLY leg as configured. May not be in force — see `effective_percent`. */
  discount_percent: number;
  /** The ANNUAL leg as configured. Independent of the monthly one. */
  annual_discount_percent?: number;
  /**
   * The cycle this account is actually on. The leg for THIS interval is the one
   * that decides whether a free period can be granted, because that is the leg
   * the server re-checks.
   */
  billing_interval?: string;
  note: string | null;
  updated_at: string | null;
  starts_at: string | null;
  expires_at: string | null;
  /** What the server resolves each leg to RIGHT NOW (0 once lapsed). */
  effective_percent: number;
  effective_annual_percent?: number;
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
  /** The MONTHLY leg that was previewed. */
  discount_percent: number;
  /**
   * The ANNUAL leg that was previewed. Absent means it was not supplied and the
   * server assumed 0 — it does NOT mirror the monthly percent, because that
   * mirroring is exactly the coupling the two legs were separated to remove.
   */
  annual_discount_percent?: number;
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
  if (lower.includes("not_fully_discounted")) {
    return "This account is not fully discounted, so there is nothing to activate for free.";
  }
  // The free-period grant refuses while a payment is with the provider, because
  // settling it would grant a second period (review finding F1).
  if (lower.includes("payment_reconciliation_required")) {
    return "This account has a payment already sent to the provider. Wait for it to settle or cancel it before granting a free period.";
  }
  // Unreachable server-side by construction, so reaching it means something is
  // genuinely wrong; say that plainly rather than reporting a success.
  if (lower.includes("free_activation_conflict")) {
    return "A free period already covers this window. Nothing was granted — check the account's history before retrying.";
  }
  // The ADMIN bound, 0-99. The campaign screen has its own 0-90 message for the
  // same code — the two mechanisms are bounded differently on purpose, and each
  // screen only ever sees its own RPC's refusals.
  if (lower.includes("annual_discount_out_of_range")) {
    return `An annual discount must be between 0% and ${MAX_ADMIN_DISCOUNT_PERCENT}%.`;
  }
  if (lower.includes("discount_below_minimum")) {
    return "Campaign prices cannot go below UGX 5,000 per month.";
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
  /**
   * The annual leg. Omitted means the server previews it at 0 — the two legs are
   * previewed independently, never mirrored.
   */
  annualDiscountPercent?: number;
}): Promise<AdminDiscountFetchResult<AdminDiscountPreview>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("admin_discount_preview", {
    p_plan_code: input.planCode,
    p_discount_percent: normalizeDiscountPercent(input.discountPercent),
    p_individual: input.individual,
    p_annual_discount_percent:
      input.annualDiscountPercent === undefined
        ? null
        : normalizeDiscountPercent(input.annualDiscountPercent),
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
  /**
   * The annual leg. MUST be sent by this screen — omitting it leaves the plan's
   * existing annual leg untouched rather than clearing it, which is a safety
   * default for older clients, not a useful behaviour for the editor.
   */
  annualDiscountPercent: number;
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
    p_annual_discount_percent: normalizeDiscountPercent(input.annualDiscountPercent),
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
  /**
   * The annual leg. Same rule as the global setter: omitting it leaves the
   * account's existing annual leg untouched. Clearing an account's discount
   * means sending 0 on BOTH legs — a monthly 0 alone leaves an annual rule in
   * place, because the two are no longer the same thing.
   */
  annualDiscountPercent: number;
  reason?: string | null;
  /** Optional window, shared by both legs. Enforced server-side, not here. */
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
    p_annual_discount_percent: normalizeDiscountPercent(input.annualDiscountPercent),
  });
  const envelope = unwrap(data, error);
  return envelope.ok === true
    ? { ok: true, computed: envelope as Record<string, unknown> }
    : { ok: false, error: envelope.error ?? "The account discount could not be saved." };
}

// ---------------------------------------------------------------------------
// The authoritative amount — and the free activation that replaces a payment
// ---------------------------------------------------------------------------

export type AdminExpectedAmount = {
  subscription_id: string;
  organization_id: string | null;
  plan_code: string;
  billing_interval: string;
  /**
   * The effective percentage for THIS subscription's own cycle. `fully_discounted`
   * and the free-period grant both key on it — a 100% monthly rule does not make
   * a yearly period free, and the reverse holds too.
   */
  effective_discount_percent: number;
  effective_monthly_discount_percent?: number;
  effective_annual_discount_percent?: number;
  /** The MONTHLY leg as configured. */
  individual_discount_percent: number;
  /** The ANNUAL leg as configured. */
  individual_annual_discount_percent?: number;
  /** Each cycle priced with its OWN leg. */
  monthly_ugx: number;
  annual_ugx: number;
  /** What the money path charges for this subscription's own billing cycle. */
  expected_amount_ugx: number;
  fully_discounted: boolean;
};

/**
 * What the server says this subscription costs right now. The console shows
 * THIS number, never a price derived from the public book — the public book
 * excludes the account's discount by design, which is how a discounted shop came
 * to be offered the full list price.
 */
export async function fetchAdminExpectedAmount(
  subscriptionId: string,
): Promise<AdminDiscountFetchResult<AdminExpectedAmount>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("admin_subscription_expected_amount", {
    p_subscription_id: subscriptionId,
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: envelope.error ?? "The amount could not be calculated." };
  }
  return { ok: true, data: envelope as unknown as AdminExpectedAmount };
}

export type AdminFreeActivation = {
  idempotent: boolean;
  activation_id: string;
  subscription_id: string;
  plan_code: string;
  billing_interval: string;
  discount_percent: number;
  period_start: string;
  period_end: string | null;
  payment_required: number;
};

/**
 * Grants one period to a fully discounted account WITHOUT a payment.
 *
 * Only usable where the discount really resolves to 100% — the server re-checks
 * that, the window and the price, and refuses otherwise. A retry returns the
 * activation it already made (`idempotent: true`) rather than granting a second
 * period, so a double click is safe.
 */
export async function activateAdminFreePeriod(input: {
  subscriptionId: string;
  reason?: string | null;
}): Promise<AdminDiscountFetchResult<AdminFreeActivation>> {
  if (!supabase) return { ok: false, error: "Not configured for this build." };

  const { data, error } = await supabase.rpc("admin_subscription_activate_free", {
    p_subscription_id: input.subscriptionId,
    p_reason: input.reason?.trim() ? input.reason.trim() : null,
  });
  const envelope = unwrap(data, error);
  if (envelope.ok !== true) {
    return { ok: false, error: envelope.error ?? "The free period could not be activated." };
  }
  return { ok: true, data: envelope as unknown as AdminFreeActivation };
}
