import type { Permission, UserRole } from "../types";
import { hasPermission } from "./permissions";

export type SubscriptionPlanCode = "free" | "starter" | "business" | "waka_plus";

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
  free: 0,
  starter: 1,
  business: 2,
  waka_plus: 3,
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
  const c = (raw ?? "free").trim().toLowerCase();
  if (c === "free" || c === "free_mode") return "free";
  if (c === "starter") return "starter";
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
 * - New users: Free Mode immediately, no admin approval required.
 * - Paid rows unlock Starter, Business, or Waka Plus.
 */
export function resolveEffectivePlanTier(snapshot: SubscriptionSnapshot): SubscriptionPlanCode {
  if (snapshot.kind === "local_full") return "waka_plus";
  if (snapshot.kind === "none") return "free";

  const row = snapshot.row;
  const trialLike = row.status === "trial" || row.status === "trialing";
  if (trialLike) return "free";

  if (row.status === "expired") {
    return "free";
  }

  return normalizePlanCode(row.plan_code);
}

export function trialDaysRemaining(snapshot: SubscriptionSnapshot, nowMs: number = Date.now()): number | null {
  if (snapshot.kind !== "remote") return null;
  const row = snapshot.row;
  const trialLike = row.status === "trial" || row.status === "trialing";
  if (!trialLike || !row.trial_ends_at) return null;
  const end = new Date(row.trial_ends_at).getTime();
  const ms = end - nowMs;
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

const MS_DAY = 86400000;
const MS_HOUR = 3600000;

/** Paid Business / VIP — starter “active” is not treated as a paid commercial plan here. */
export function hasActivePaidSubscription(row: RemoteSubscriptionRow, _nowMs: number = Date.now()): boolean {
  const st = (row.status ?? "").trim().toLowerCase();
  if (st !== "active") return false;
  const tier = normalizePlanCode(row.plan_code);
  return tier === "business" || tier === "waka_plus";
}

export function isLiveBusinessTrial(row: RemoteSubscriptionRow, nowMs: number = Date.now()): boolean {
  const trialLike = row.status === "trial" || row.status === "trialing";
  if (!trialLike || !row.trial_ends_at) return false;
  return new Date(row.trial_ends_at).getTime() > nowMs;
}

/** Business trial window ended (including last day at 0 days left). */
export function hasBusinessTrialEnded(row: RemoteSubscriptionRow, nowMs: number = Date.now()): boolean {
  const trialLike = row.status === "trial" || row.status === "trialing";
  if (!trialLike || !row.trial_ends_at) return false;
  return new Date(row.trial_ends_at).getTime() <= nowMs;
}

export function shouldHideStarterTrialRequestCta(params: {
  snapshot: SubscriptionSnapshot;
  nowMs: number;
  starterRequestConsumed: boolean;
  pendingStarterRequestCreatedAt: string | null;
}): boolean {
  const { snapshot, nowMs, starterRequestConsumed, pendingStarterRequestCreatedAt } = params;
  if (snapshot.kind === "local_full") return true;
  if (starterRequestConsumed) return true;
  if (pendingStarterRequestCreatedAt) return true;
  if (snapshot.kind === "none") return false;

  const row = snapshot.row;
  if (hasActivePaidSubscription(row, nowMs)) return true;
  if (isLiveBusinessTrial(row, nowMs)) return true;
  if (hasBusinessTrialEnded(row, nowMs)) return true;
  return false;
}

/**
 * Countdown to `current_period_end` for paid subscriptions.
 * VIP (Waka Plus) and other paid tiers use this for renewals.
 */
export function getPaidPlanRenewalCountdown(
  snapshot: SubscriptionSnapshot,
  nowMs: number = Date.now(),
): { plan: SubscriptionPlanCode; days: number; hours: number; totalMs: number } | null {
  if (snapshot.kind !== "remote") return null;
  const row = snapshot.row;
  const st = (row.status ?? "").trim().toLowerCase();
  if (st !== "active") return null;
  const plan = normalizePlanCode(row.plan_code);
  if (plan === "free" || plan === "starter") return null;
  if (!row.current_period_end) return null;
  const end = new Date(row.current_period_end).getTime();
  const totalMs = end - nowMs;
  if (totalMs <= 0) {
    return { plan, days: 0, hours: 0, totalMs };
  }
  const days = Math.floor(totalMs / MS_DAY);
  const hours = Math.floor((totalMs % MS_DAY) / MS_HOUR);
  return { plan, days, hours, totalMs };
}

export function maxStaffAccountsForTier(tier: SubscriptionPlanCode): number {
  if (tier === "free") return 0;
  if (tier === "starter") return 0;
  if (tier === "business") return 5;
  return 10;
}

export function maxDevicesHintForTier(tier: SubscriptionPlanCode): number {
  if (tier === "free") return 1;
  if (tier === "starter") return 1;
  if (tier === "business") return 3;
  return 8;
}

export function maxProductsForTier(tier: SubscriptionPlanCode): number | null {
  return tier === "free" ? 30 : null;
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
