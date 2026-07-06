import type { Permission, UserRole } from "../types";
import { hasPermission } from "./permissions";

export type SubscriptionPlanCode = "free" | "starter" | "business" | "waka_plus";

export const FREE_PLAN_PRODUCT_LIMIT = 7;

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
  /** From subscription_plans.features.devices when present. */
  max_devices: number | null;
};

/**
 * Active promotional grant (growth campaign / referral / manual admin grant).
 * Grants temporary premium access on top of — never instead of — the real
 * subscription row.
 */
export type PromotionalGrantRow = {
  id: string;
  plan_code: string;
  granted_by: string;
  campaign_id: string | null;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
};

export type SubscriptionSnapshot =
  | { kind: "local_full" }
  | { kind: "none"; promotionalGrant?: PromotionalGrantRow | null }
  | { kind: "remote"; row: RemoteSubscriptionRow; promotionalGrant?: PromotionalGrantRow | null };

const TIER_RANK: Record<SubscriptionPlanCode, number> = {
  free: 0,
  starter: 1,
  business: 2,
  waka_plus: 3,
};

/** Permissions that need at least Starter (profit, backup marketing alignment). */
const STARTER_PLUS: ReadonlySet<Permission> = new Set(["reports.profit"]);

/** Permissions that need at least Business. */
const BUSINESS_PLUS: ReadonlySet<Permission> = new Set([
  "settings.shop",
  "owner.dashboard",
  "owner.activity",
  "owner.cash_history",
  "enterprise.access",
  "enterprise.dashboard",
  "enterprise.reports",
  "enterprise.audit",
]);

/** Permissions that need Waka Plus (reserved). */
const WAKA_PLUS_ONLY: ReadonlySet<Permission> = new Set([
  "enterprise.branches",
  "enterprise.transfers",
  "enterprise.purchasing",
  "enterprise.backup",
  "enterprise.health",
] as Permission[]);

export function normalizePlanCode(raw: string | undefined | null): SubscriptionPlanCode {
  const c = (raw ?? "free").trim().toLowerCase();
  if (c === "free" || c === "free_mode") return "free";
  if (c === "starter") return "starter";
  if (c === "business") return "business";
  if (c === "waka_plus" || c === "waka plus") return "waka_plus";
  return "starter";
}

/** Tier from an active (non-revoked, non-expired) promotional grant, or null. */
export function resolvePromotionalGrantTier(
  snapshot: SubscriptionSnapshot,
  nowMs: number = Date.now(),
): SubscriptionPlanCode | null {
  if (snapshot.kind === "local_full") return null;
  const grant = snapshot.promotionalGrant;
  if (!grant || grant.revoked_at) return null;
  const end = new Date(grant.expires_at).getTime();
  if (!Number.isFinite(end) || end <= nowMs) return null;
  const tier = normalizePlanCode(grant.plan_code);
  return tier === "free" ? null : tier;
}

/** Underlying tier from the real subscription only (paid → trial → free). */
function resolveBasePlanTier(snapshot: SubscriptionSnapshot, nowMs: number): SubscriptionPlanCode {
  if (snapshot.kind === "local_full") return "waka_plus";
  if (snapshot.kind === "none") return "free";

  const row = snapshot.row;
  const trialLike = row.status === "trial" || row.status === "trialing";
  if (trialLike) return normalizePlanCode(row.plan_code);

  if (row.status === "expired") {
    return "free";
  }

  if (row.status === "active" && row.current_period_end) {
    const periodEndMs = new Date(row.current_period_end).getTime();
    if (Number.isFinite(periodEndMs) && periodEndMs <= nowMs) return "free";
  }

  return normalizePlanCode(row.plan_code);
}

/**
 * Effective subscription tier for feature gates.
 * Priority: active promotional grant → active paid subscription → trial → free.
 * A grant never downgrades a higher paid tier (no feature loss during campaigns),
 * and on grant expiry the shop falls back to its real subscription automatically.
 */
export function resolveEffectivePlanTier(
  snapshot: SubscriptionSnapshot,
  nowMs: number = Date.now(),
): SubscriptionPlanCode {
  const base = resolveBasePlanTier(snapshot, nowMs);
  const grantTier = resolvePromotionalGrantTier(snapshot, nowMs);
  if (grantTier && TIER_RANK[grantTier] > TIER_RANK[base]) return grantTier;
  return base;
}

export function tierMeetsMinimum(tier: SubscriptionPlanCode, minimum: SubscriptionPlanCode): boolean {
  return TIER_RANK[tier] >= TIER_RANK[minimum];
}

/** True when org has Starter, Business, or Waka Plus (including trial period on those plans, or an active promotional grant). */
export function hasCommercialSubscription(snapshot: SubscriptionSnapshot): boolean {
  if (snapshot.kind === "local_full") return true;
  if (resolvePromotionalGrantTier(snapshot) !== null) return true;
  if (snapshot.kind !== "remote") return false;
  const row = snapshot.row;
  const plan = normalizePlanCode(row.plan_code);
  if (plan === "free") return false;
  const st = (row.status ?? "").trim().toLowerCase();
  return st === "active" || st === "trial" || st === "trialing";
}

/** “Why upgrade?” and similar free-only upsell — not for paid or trial commercial plans. */
export function shouldShowFreeUpgradePitch(snapshot: SubscriptionSnapshot): boolean {
  return !hasCommercialSubscription(snapshot);
}

export function canUseBackupRestore(
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
): boolean {
  if (authMode === "local") return true;
  return tierMeetsMinimum(resolveEffectivePlanTier(snapshot), "starter");
}

const MS_DAY = 86400000;
const MS_HOUR = 3600000;

/** Paid commercial plans (Starter, Business, Waka Plus). */
export function hasActivePaidSubscription(row: RemoteSubscriptionRow, _nowMs: number = Date.now()): boolean {
  const st = (row.status ?? "").trim().toLowerCase();
  if (st !== "active") return false;
  const tier = normalizePlanCode(row.plan_code);
  return tier === "starter" || tier === "business" || tier === "waka_plus";
}

/**
 * Countdown to `current_period_end` for paid subscriptions.
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
  if (plan === "free") return null;
  if (!row.current_period_end) return null;
  const end = new Date(row.current_period_end).getTime();
  const totalMs = end - nowMs;
  if (totalMs <= 0) return null;
  const days = Math.floor(totalMs / MS_DAY);
  const hours = Math.floor((totalMs % MS_DAY) / MS_HOUR);
  return { plan, days, hours, totalMs };
}

export function maxStaffAccountsForTier(tier: SubscriptionPlanCode): number {
  if (tier === "free") return 0;
  if (tier === "starter") return 2;
  if (tier === "business") return 4;
  return 10;
}

export function maxDevicesHintForTier(tier: SubscriptionPlanCode): number {
  if (tier === "free" || tier === "starter") return 1;
  if (tier === "business") return 4;
  return 10;
}

/** Authoritative device cap for a tier when DB features JSON is missing or stale. */
export function planDeviceLimitForTier(tier: SubscriptionPlanCode): number {
  return maxDevicesHintForTier(tier);
}

export function maxProductsForTier(tier: SubscriptionPlanCode): number | null {
  return tier === "free" ? FREE_PLAN_PRODUCT_LIMIT : null;
}

function minTierForPermission(permission: Permission): SubscriptionPlanCode | null {
  if (WAKA_PLUS_ONLY.has(permission)) return "waka_plus";
  if (BUSINESS_PLUS.has(permission)) return "business";
  if (STARTER_PLUS.has(permission)) return "starter";
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
