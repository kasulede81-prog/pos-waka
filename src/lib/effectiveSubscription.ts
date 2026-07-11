/**
 * Enterprise Subscription Resolver — Phase 16.4
 *
 * Single authoritative resolver for effective subscription state.
 * All feature gates, device limits, and tier decisions must flow through here.
 *
 * Phase 16.5 will add mutation methods (grant/extend/renew/cancel) that write
 * through the same pipeline and produce standardized audit payloads.
 */

import type {
  PromotionalGrantRow,
  RemoteSubscriptionRow,
  SubscriptionPlanCode,
  SubscriptionSnapshot,
} from "./subscriptionEntitlements";
import { normalizePlanCode, planDeviceLimitForTier } from "./subscriptionEntitlements";

export type SubscriptionSource = "local_full" | "subscription" | "promotional_grant" | "none";

export type SubscriptionLifecycleStatus =
  | "trial"
  | "trialing"
  | "active"
  | "expired"
  | "cancelled"
  | "paused"
  | "none";

export type SubscriptionType = "trial" | "paid" | "free" | "promotional";

export type BillingCycle = "monthly" | "yearly" | "custom" | null;

/** Normalized effective subscription — consumed by all readers. */
export type EffectiveSubscription = {
  planCode: SubscriptionPlanCode;
  planTier: SubscriptionPlanCode;
  subscriptionType: SubscriptionType;
  status: SubscriptionLifecycleStatus;
  source: SubscriptionSource;
  billingCycle: BillingCycle;
  startsAt: string | null;
  expiresAt: string | null;
  trialEndsAt: string | null;
  promotionalGrant: PromotionalGrantRow | null;
  effectivePlan: SubscriptionPlanCode;
  isTrial: boolean;
  isPaid: boolean;
  isExpired: boolean;
  daysRemaining: number | null;
  deviceLimit: number | null;
};

const TIER_RANK: Record<SubscriptionPlanCode, number> = {
  free: 0,
  starter: 1,
  business: 2,
  waka_plus: 3,
};

const MS_DAY = 86400000;

/** Phase 16.5 engine extension point — mutations plug in here. */
export type SubscriptionEngineExtensionPoint = {
  readonly resolverVersion: "16.4";
  resolveEffectiveSubscription: typeof resolveEffectiveSubscription;
};

export const SUBSCRIPTION_ENGINE_EXTENSION_POINT: SubscriptionEngineExtensionPoint = {
  resolverVersion: "16.4",
  resolveEffectiveSubscription,
};

function tierRank(tier: SubscriptionPlanCode): number {
  return TIER_RANK[tier];
}

function higherTier(a: SubscriptionPlanCode, b: SubscriptionPlanCode): SubscriptionPlanCode {
  return tierRank(a) >= tierRank(b) ? a : b;
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function daysRemainingFromMs(endMs: number | null, nowMs: number): number | null {
  if (endMs === null) return null;
  const diff = endMs - nowMs;
  if (diff <= 0) return 0;
  return Math.ceil(diff / MS_DAY);
}

function normalizeLifecycleStatus(raw: string | undefined | null): SubscriptionLifecycleStatus {
  const st = (raw ?? "").trim().toLowerCase();
  if (st === "trial" || st === "trialing" || st === "active" || st === "expired") return st;
  if (st === "cancelled" || st === "canceled") return "cancelled";
  if (st === "paused") return "paused";
  return "none";
}

function isTrialLikeStatus(status: SubscriptionLifecycleStatus): boolean {
  return status === "trial" || status === "trialing";
}

/** Active promotional grant tier, or null when absent / expired / revoked. */
export function resolveActivePromotionalGrantTier(
  snapshot: SubscriptionSnapshot,
  nowMs: number = Date.now(),
): SubscriptionPlanCode | null {
  if (snapshot.kind === "local_full") return null;
  const grant = snapshot.promotionalGrant;
  if (!grant || grant.revoked_at) return null;
  const endMs = parseTimestampMs(grant.expires_at);
  if (endMs === null || endMs <= nowMs) return null;
  const tier = normalizePlanCode(grant.plan_code);
  return tier === "free" ? null : tier;
}

type BaseSubscriptionResolution = {
  planCode: SubscriptionPlanCode;
  status: SubscriptionLifecycleStatus;
  isTrial: boolean;
  isPaid: boolean;
  isExpired: boolean;
  trialEndsAt: string | null;
  expiresAt: string | null;
  startsAt: string | null;
  billingCycle: BillingCycle;
};

/** Underlying tier from the real subscription row only (paid → trial → free). */
function resolveBaseSubscription(
  snapshot: SubscriptionSnapshot,
  nowMs: number,
): BaseSubscriptionResolution {
  if (snapshot.kind === "local_full") {
    return {
      planCode: "waka_plus",
      status: "active",
      isTrial: false,
      isPaid: true,
      isExpired: false,
      trialEndsAt: null,
      expiresAt: null,
      startsAt: null,
      billingCycle: null,
    };
  }

  if (snapshot.kind === "none") {
    return {
      planCode: "free",
      status: "none",
      isTrial: false,
      isPaid: false,
      isExpired: false,
      trialEndsAt: null,
      expiresAt: null,
      startsAt: null,
      billingCycle: null,
    };
  }

  const row = snapshot.row;
  const rawStatus = normalizeLifecycleStatus(row.status);
  const storedPlan = normalizePlanCode(row.plan_code);
  const trialEndsAt = row.trial_ends_at ?? null;
  const trialEndMs = parseTimestampMs(trialEndsAt);
  const periodEndMs = parseTimestampMs(row.current_period_end);
  const periodStartMs = parseTimestampMs(row.current_period_start);
  const startsAt = row.current_period_start ?? null;

  let billingCycle: BillingCycle = null;
  if (periodStartMs !== null && periodEndMs !== null && periodEndMs > periodStartMs) {
    const spanDays = (periodEndMs - periodStartMs) / MS_DAY;
    billingCycle = spanDays >= 330 ? "yearly" : spanDays >= 20 ? "monthly" : "custom";
  }

  if (rawStatus === "expired") {
    return {
      planCode: "free",
      status: "expired",
      isTrial: false,
      isPaid: false,
      isExpired: true,
      trialEndsAt,
      expiresAt: trialEndsAt ?? row.current_period_end ?? null,
      startsAt,
      billingCycle,
    };
  }

  if (isTrialLikeStatus(rawStatus)) {
    const trialExpired = trialEndMs !== null && trialEndMs <= nowMs;
    if (trialExpired) {
      return {
        planCode: "free",
        status: "expired",
        isTrial: false,
        isPaid: false,
        isExpired: true,
        trialEndsAt,
        expiresAt: trialEndsAt,
        startsAt,
        billingCycle,
      };
    }
    return {
      planCode: storedPlan === "free" ? "free" : storedPlan,
      status: rawStatus,
      isTrial: storedPlan !== "free",
      isPaid: false,
      isExpired: false,
      trialEndsAt,
      expiresAt: trialEndsAt ?? row.current_period_end ?? null,
      startsAt,
      billingCycle,
    };
  }

  if (rawStatus === "active" && periodEndMs !== null && periodEndMs <= nowMs) {
    return {
      planCode: "free",
      status: "expired",
      isTrial: false,
      isPaid: false,
      isExpired: true,
      trialEndsAt,
      expiresAt: row.current_period_end ?? null,
      startsAt,
      billingCycle,
    };
  }

  const isPaid =
    rawStatus === "active" &&
    (storedPlan === "starter" || storedPlan === "business" || storedPlan === "waka_plus");

  return {
    planCode: storedPlan,
    status: rawStatus === "none" ? "active" : rawStatus,
    isTrial: false,
    isPaid,
    isExpired: false,
    trialEndsAt,
    expiresAt: row.current_period_end ?? null,
    startsAt,
    billingCycle,
  };
}

function resolveEffectiveSource(
  snapshot: SubscriptionSnapshot,
  base: BaseSubscriptionResolution,
  grantTier: SubscriptionPlanCode | null,
): SubscriptionSource {
  if (grantTier && tierRank(grantTier) > tierRank(base.planCode)) return "promotional_grant";
  if (snapshot.kind === "remote") return "subscription";
  if (grantTier) return "promotional_grant";
  return "none";
}

function resolveSubscriptionType(
  base: BaseSubscriptionResolution,
  grantTier: SubscriptionPlanCode | null,
  effectivePlan: SubscriptionPlanCode,
): SubscriptionType {
  if (effectivePlan === "free") return "free";
  if (base.isTrial) return "trial";
  if (grantTier && tierRank(grantTier) >= tierRank(base.planCode) && !base.isPaid) return "promotional";
  if (base.isPaid) return "paid";
  if (grantTier) return "promotional";
  return "free";
}

function resolveDeviceLimitFromSnapshot(
  snapshot: SubscriptionSnapshot,
  effectivePlan: SubscriptionPlanCode,
  authMode: "supabase" | "local",
): number | null {
  if (authMode === "local" || snapshot.kind === "local_full") return null;
  if (snapshot.kind === "remote") {
    const fromRow = snapshot.row.max_devices;
    if (fromRow != null && fromRow > 0) {
      const rowTier = normalizePlanCode(snapshot.row.plan_code);
      if (tierRank(effectivePlan) <= tierRank(rowTier)) return fromRow;
    }
  }
  return planDeviceLimitForTier(effectivePlan);
}

/**
 * Authoritative effective subscription resolver.
 * Priority: active promotional grant (upgrade only) → subscription base tier → free.
 */
export function resolveEffectiveSubscription(
  snapshot: SubscriptionSnapshot,
  nowMs: number = Date.now(),
  authMode: "supabase" | "local" = "supabase",
): EffectiveSubscription {
  const base = resolveBaseSubscription(snapshot, nowMs);
  const grantTier = resolveActivePromotionalGrantTier(snapshot, nowMs);
  const grant = grantTier ? (snapshot.kind === "local_full" ? null : snapshot.promotionalGrant ?? null) : null;

  let effectivePlan = base.planCode;
  if (grantTier) effectivePlan = higherTier(base.planCode, grantTier);

  const grantEndMs = grant ? parseTimestampMs(grant.expires_at) : null;
  const baseEndMs = parseTimestampMs(base.expiresAt);
  const expiryMs =
    grantTier && tierRank(grantTier) > tierRank(base.planCode) && grantEndMs !== null
      ? grantEndMs
      : baseEndMs;

  const source =
    snapshot.kind === "local_full"
      ? "local_full"
      : resolveEffectiveSource(snapshot, base, grantTier);

  const subscriptionType = resolveSubscriptionType(base, grantTier, effectivePlan);

  const deviceLimit = resolveDeviceLimitFromSnapshot(snapshot, effectivePlan, authMode);

  return {
    planCode: base.planCode,
    planTier: effectivePlan,
    subscriptionType,
    status: base.isExpired ? "expired" : base.status,
    source,
    billingCycle: base.billingCycle,
    startsAt: base.startsAt,
    expiresAt: expiryMs !== null ? new Date(expiryMs).toISOString() : base.expiresAt,
    trialEndsAt: base.trialEndsAt,
    promotionalGrant: grant,
    effectivePlan,
    isTrial: base.isTrial && !base.isExpired,
    isPaid: base.isPaid && !base.isExpired,
    isExpired: base.isExpired,
    daysRemaining: daysRemainingFromMs(expiryMs, nowMs),
    deviceLimit,
  };
}

/** Convenience: effective plan tier for feature gates. */
export function resolveEffectivePlanTierFromResolver(
  snapshot: SubscriptionSnapshot,
  nowMs: number = Date.now(),
): SubscriptionPlanCode {
  return resolveEffectiveSubscription(snapshot, nowMs).effectivePlan;
}

/** Device cap from effective subscription — never duplicate tier logic elsewhere. */
export function resolveEffectiveDeviceLimit(
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
  nowMs: number = Date.now(),
): number | null {
  return resolveEffectiveSubscription(snapshot, nowMs, authMode).deviceLimit;
}

/** Re-export row type for engine / audit consumers. */
export type { RemoteSubscriptionRow, PromotionalGrantRow, SubscriptionSnapshot };
