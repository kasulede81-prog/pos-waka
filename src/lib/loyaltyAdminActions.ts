/**
 * Internal-admin Loyalty ACTIONS (Phase 6C).
 *
 * The only write path from the browser into the Loyalty control plane. Every function here
 * calls one of the four Phase 6A SECURITY DEFINER mutation RPCs, which remain the authority
 * for authorization (super_admin / operations_admin), validation, the mutation itself, the
 * audit event and atomicity. Nothing here touches a table directly, and nothing here writes
 * an audit record — the server writes it in the same transaction as the change.
 *
 * The client-side checks below exist only to give an admin a fast, specific message before
 * a round-trip. They never replace the server checks: a caller that skips them is refused
 * by the RPC with the same error codes.
 *
 * Kept separate from `loyaltyAdmin.ts` on purpose, so the 6B read layer stays provably
 * read-only.
 */

import { hasSupabaseConfig, supabase } from "./supabase";
import type { LoyaltyAdminPlan, LoyaltyAdminShopState } from "./loyaltyAdmin";

/** Server floor is 3 characters (reason_required); the UI asks for a sentence, not a word. */
export const LOYALTY_ADMIN_REASON_MIN = 8;
export const LOYALTY_ADMIN_REASON_MAX = 300;

export type LoyaltyAdminMutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: Record<string, unknown> };

export type LoyaltyPlanDraft = {
  code: string;
  name: string;
  memberLimit: number;
  monthlyPriceUgx: number;
  annualPriceUgx: number;
  sortOrder: number;
};

export type LoyaltyPlanMutationData = {
  code: string;
  memberLimitChanged: boolean;
};

export type LoyaltyEntitlementMutationData = {
  organizationId: string;
  loyaltyEnabled: boolean;
  tierCode: string | null;
  memberLimit: number;
};

// ---------------------------------------------------------------------------
// Validation (mirrors the RPCs; the RPCs remain authoritative)
// ---------------------------------------------------------------------------

export function validateAdminReason(reason: string): string | null {
  const r = reason.trim();
  if (r.length === 0) return "A reason is required for every Loyalty admin change.";
  if (r.length < LOYALTY_ADMIN_REASON_MIN) {
    return `Describe why in at least ${LOYALTY_ADMIN_REASON_MIN} characters — this is recorded in the audit log.`;
  }
  if (r.length > LOYALTY_ADMIN_REASON_MAX) return `Keep the reason under ${LOYALTY_ADMIN_REASON_MAX} characters.`;
  return null;
}

export type LoyaltyPlanDraftErrors = Partial<Record<keyof LoyaltyPlanDraft, string>>;

export function validatePlanDraft(draft: LoyaltyPlanDraft, mode: "create" | "edit"): LoyaltyPlanDraftErrors {
  const errors: LoyaltyPlanDraftErrors = {};
  if (mode === "create" && !/^[a-z][a-z0-9_]{1,31}$/.test(draft.code.trim().toLowerCase())) {
    errors.code = "2–32 characters: lowercase letters, digits or _, starting with a letter.";
  }
  const name = draft.name.trim();
  if (!name || name.length > 60) errors.name = "Name is required (max 60 characters).";
  if (!Number.isInteger(draft.memberLimit) || draft.memberLimit < 0) {
    errors.memberLimit = "Member limit must be a whole number, 0 or more.";
  }
  if (!Number.isFinite(draft.monthlyPriceUgx) || draft.monthlyPriceUgx < 0) {
    errors.monthlyPriceUgx = "Price cannot be negative.";
  }
  if (!Number.isFinite(draft.annualPriceUgx) || draft.annualPriceUgx < 0) {
    errors.annualPriceUgx = "Price cannot be negative.";
  }
  if (!Number.isInteger(draft.sortOrder)) errors.sortOrder = "Sort order must be a whole number.";
  return errors;
}

// ---------------------------------------------------------------------------
// Structured error messages for every code the 6A RPCs can return
// ---------------------------------------------------------------------------

export function describeLoyaltyAdminError(code: string, details?: Record<string, unknown>): string {
  switch (code) {
    case "forbidden":
      return "You are not authorized to change Loyalty. Only super_admin and operations_admin can.";
    case "reason_required":
      return "The server refused the change: a reason of 3–300 characters is required.";
    case "invalid_code":
      return "Invalid plan code. Use 2–32 lowercase letters, digits or _, starting with a letter.";
    case "code_exists":
      return "A plan with this code already exists. Choose a different code.";
    case "invalid_name":
      return "Invalid plan name (required, max 60 characters).";
    case "invalid_member_limit":
      return "Invalid member limit (must be 0 or more).";
    case "invalid_price":
      return "Prices cannot be negative.";
    case "tier_not_found":
      return "That plan no longer exists. Refresh and try again.";
    case "tier_inactive":
      return "That plan is inactive and cannot be assigned. Activate it first or pick an active plan.";
    case "tier_is_default":
      return "The default (fallback) plan cannot be deactivated.";
    case "tier_in_use": {
      const n = Number(details?.organizations ?? 0);
      return n > 0
        ? `This plan is assigned to ${n} organization(s) and cannot be deactivated. Move them to another plan first.`
        : "This plan is assigned to organizations and cannot be deactivated.";
    }
    case "last_active_tier":
      return "This is the last active plan; at least one plan must stay active.";
    case "invalid_state":
    case "invalid_status":
      return "Invalid target state for this change.";
    case "invalid_shop":
    case "shop_not_found":
      return "That shop could not be found. Refresh and try again.";
    case "offline":
      return "Not connected to the server. No change was made.";
    case "network":
      return "The request did not complete. Refresh to confirm the current state before retrying.";
    default:
      return "The change was refused by the server. No change was made.";
  }
}

// ---------------------------------------------------------------------------
// RPC plumbing
// ---------------------------------------------------------------------------

async function callMutation<T>(
  fn: string,
  args: Record<string, unknown>,
  map: (raw: Record<string, unknown>) => T,
): Promise<LoyaltyAdminMutationResult<T>> {
  if (!hasSupabaseConfig || !supabase) return { ok: false, error: "offline" };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      // A transport-level refusal (e.g. no EXECUTE for this role) is a denial, not a success.
      const msg = String((error as { message?: string }).message ?? "");
      const code = String((error as { code?: string }).code ?? "");
      return { ok: false, error: code === "42501" || /permission denied/i.test(msg) ? "forbidden" : "rpc_failed" };
    }
    const raw = (data ?? {}) as Record<string, unknown>;
    // Only an explicit ok:true is success; anything else is reported as the server's code.
    if (raw.ok !== true) {
      const { ok: _ok, error: err, ...details } = raw;
      return { ok: false, error: String(err ?? "rpc_failed"), details };
    }
    return { ok: true, data: map(raw) };
  } catch {
    // Unknown outcome: never report success, and tell the admin to re-read before retrying.
    return { ok: false, error: "network" };
  }
}

function planArgs(draft: LoyaltyPlanDraft, reason: string) {
  return {
    p_code: draft.code.trim().toLowerCase(),
    p_name: draft.name.trim(),
    p_member_limit: draft.memberLimit,
    p_monthly_price_ugx: Math.round(draft.monthlyPriceUgx),
    p_annual_price_ugx: Math.round(draft.annualPriceUgx),
    p_sort_order: draft.sortOrder,
    p_reason: reason.trim(),
  };
}

function mapPlan(raw: Record<string, unknown>): LoyaltyPlanMutationData {
  return { code: String(raw.code ?? ""), memberLimitChanged: raw.member_limit_changed === true };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createLoyaltyPlan(
  draft: LoyaltyPlanDraft,
  reason: string,
): Promise<LoyaltyAdminMutationResult<LoyaltyPlanMutationData>> {
  return callMutation("internal_ops_loyalty_create_plan", planArgs(draft, reason), mapPlan);
}

export async function updateLoyaltyPlan(
  draft: LoyaltyPlanDraft,
  reason: string,
): Promise<LoyaltyAdminMutationResult<LoyaltyPlanMutationData>> {
  return callMutation("internal_ops_loyalty_update_plan", planArgs(draft, reason), mapPlan);
}

export async function setLoyaltyPlanActive(
  code: string,
  isActive: boolean,
  reason: string,
): Promise<LoyaltyAdminMutationResult<LoyaltyPlanMutationData>> {
  return callMutation(
    "internal_ops_loyalty_set_plan_active",
    { p_code: code, p_is_active: isActive, p_reason: reason.trim() },
    mapPlan,
  );
}

/**
 * Enable (status 'active' + an active plan) or disable (status 'none') Loyalty for the
 * shop's ORGANIZATION. Only the entitlement row changes; disabling keeps the assigned plan
 * so re-enabling restores it, and members, points and Wallet passes are never touched.
 */
export async function setShopLoyaltyEntitlement(
  shopId: string,
  change: { enabled: true; planCode: string } | { enabled: false },
  reason: string,
): Promise<LoyaltyAdminMutationResult<LoyaltyEntitlementMutationData>> {
  return callMutation(
    "internal_ops_loyalty_set_shop_entitlement",
    {
      p_shop_id: shopId,
      p_status: change.enabled ? "active" : "none",
      p_plan_code: change.enabled ? change.planCode : null,
      p_reason: reason.trim(),
    },
    (raw) => ({
      organizationId: String(raw.organization_id ?? ""),
      loyaltyEnabled: raw.loyalty_enabled === true,
      tierCode: raw.tier_code == null ? null : String(raw.tier_code),
      memberLimit: Number(raw.member_limit ?? 0) || 0,
    }),
  );
}

// ---------------------------------------------------------------------------
// Pure impact helpers for the confirmation screens
// ---------------------------------------------------------------------------

/**
 * Was this impact measured for exactly the change about to be saved? A limit change may only
 * be confirmed against its own measurement — never one left over from an earlier draft.
 */
export function isImpactCurrent(
  impact: { tierCode: string; proposedMemberLimit: number } | null,
  code: string,
  proposedLimit: number,
): boolean {
  return impact != null && impact.tierCode === code && impact.proposedMemberLimit === proposedLimit;
}

/** Does this shop row resolve to `plan`? (A null tier resolves to the default plan.) */
export function shopUsesPlan(shop: LoyaltyAdminShopState, plan: Pick<LoyaltyAdminPlan, "code" | "isDefault">): boolean {
  return shop.tierCode === plan.code || (shop.tierCode == null && plan.isDefault);
}

/** Enabled shops on `plan` whose active members exceed `proposedLimit`, worst first. */
export function shopsOverProposedLimit(
  shops: LoyaltyAdminShopState[],
  plan: Pick<LoyaltyAdminPlan, "code" | "isDefault">,
  proposedLimit: number,
): Array<LoyaltyAdminShopState & { overBy: number }> {
  return shops
    .filter((s) => s.loyaltyEnabled && shopUsesPlan(s, plan) && s.activeMembers > proposedLimit)
    .map((s) => ({ ...s, overBy: s.activeMembers - proposedLimit }))
    .sort((a, b) => b.overBy - a.overBy);
}
