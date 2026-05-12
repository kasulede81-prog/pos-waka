import type { Permission, UserRole } from "../types";
import { hasPermission } from "./permissions";

export type SubscriptionPlanCode = "starter" | "business" | "waka_plus";

/** Row shape returned from Supabase (plan joined separately). */
export type RemoteSubscriptionRow = {
  id: string;
  organization_id: string;
  shop_id: string | null;
  status: string;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  plan_code: string;
  max_pos_users: number | null;
  max_shops: number | null;
};

export type SubscriptionSnapshot =
  | { kind: "local_full" }
  | { kind: "none" }
  | { kind: "remote"; row: RemoteSubscriptionRow };

const TIER_RANK: Record<SubscriptionPlanCode, number> = {
  starter: 0,
  business: 1,
  waka_plus: 2,
};

/** Permissions that need at least Business (or active Business trial). */
const BUSINESS_PLUS: ReadonlySet<Permission> = new Set([
  "settings.shop",
  "owner.dashboard",
  "owner.activity",
  "owner.cash_history",
  "reports.profit",
]);

/** Permissions that need Waka Plus (reserved for branch / heavy analytics). */
const WAKA_PLUS_ONLY: ReadonlySet<Permission> = new Set([] as Permission[]);

export function normalizePlanCode(raw: string | undefined | null): SubscriptionPlanCode {
  const c = (raw ?? "starter").trim().toLowerCase();
  if (c === "business") return "business";
  if (c === "waka_plus" || c === "waka plus") return "waka_plus";
  return "starter";
}

/** WhatsApp manager / priority support — catalog tier only (not effective trial tier). */
export function planCodeHasWhatsappManager(code: SubscriptionPlanCode): boolean {
  return code === "business" || code === "waka_plus";
}

/**
 * Effective SaaS tier for feature gates.
 * - New users: Business trial for 30 days (full Business features).
 * - After trial without payment: treat as Starter (sell/stock/debt stay on).
 */
export function resolveEffectivePlanTier(snapshot: SubscriptionSnapshot): SubscriptionPlanCode {
  if (snapshot.kind === "local_full") return "waka_plus";
  if (snapshot.kind === "none") return "starter";

  const row = snapshot.row;
  const now = Date.now();
  const trialEndMs = row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : 0;
  const trialLike = row.status === "trial" || row.status === "trialing";
  const inBusinessTrial = trialLike && trialEndMs > now;
  if (inBusinessTrial) return "business";

  if (trialLike && trialEndMs > 0 && trialEndMs <= now) {
    return "starter";
  }

  if (row.status === "expired") {
    return "starter";
  }

  return normalizePlanCode(row.plan_code);
}

export function trialDaysRemaining(snapshot: SubscriptionSnapshot): number | null {
  if (snapshot.kind !== "remote") return null;
  const row = snapshot.row;
  const trialLike = row.status === "trial" || row.status === "trialing";
  if (!trialLike || !row.trial_ends_at) return null;
  const end = new Date(row.trial_ends_at).getTime();
  const ms = end - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function maxStaffAccountsForTier(tier: SubscriptionPlanCode): number {
  if (tier === "starter") return 0;
  if (tier === "business") return 5;
  return 999;
}

export function maxDevicesHintForTier(tier: SubscriptionPlanCode): number {
  if (tier === "starter") return 1;
  if (tier === "business") return 3;
  return 999;
}

function minTierForPermission(permission: Permission): SubscriptionPlanCode | null {
  if (WAKA_PLUS_ONLY.has(permission)) return "waka_plus";
  if (BUSINESS_PLUS.has(permission)) return "business";
  return null;
}

export function planAllowsPermission(tier: SubscriptionPlanCode, permission: Permission): boolean {
  const need = minTierForPermission(permission);
  if (!need) return true;
  return TIER_RANK[tier] >= TIER_RANK[need];
}

export function hasEffectivePermission(
  role: UserRole,
  permission: Permission,
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
): boolean {
  if (!hasPermission(role, permission)) return false;
  if (authMode === "local") return true;
  const tier = resolveEffectivePlanTier(snapshot);
  return planAllowsPermission(tier, permission);
}
