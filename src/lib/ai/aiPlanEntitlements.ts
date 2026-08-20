/**
 * AI plan request caps. WAKA billing codes map onto these keys.
 * Enforced in check_ai_feature_allowed as a shop monthly ceiling (null = unlimited).
 */
import type { SubscriptionPlanCode } from "../subscriptionEntitlements";

export type AiPlanLimits = {
  free: number | null;
  starter: number | null;
  business: number | null;
  enterprise: number | null;
};

/** Matches SQL platform_default_ai_settings().plan_limits */
export const DEFAULT_AI_PLAN_LIMITS: AiPlanLimits = {
  free: 50,
  starter: 500,
  business: 5000,
  enterprise: null,
};

export type AiPlanCode = keyof AiPlanLimits;

function numOrNull(v: unknown, fallback: number | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function mapWakaPlanToAiPlanCode(plan: SubscriptionPlanCode | string | null | undefined): AiPlanCode {
  const raw = String(plan ?? "free").toLowerCase();
  if (raw === "waka_plus" || raw === "enterprise") return "enterprise";
  if (raw === "business" || raw === "premium") return "business";
  if (raw === "starter" || raw === "standard") return "starter";
  return "free";
}

export function parseAiPlanLimits(raw: unknown): AiPlanLimits {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    free: "free" in obj ? numOrNull(obj.free, DEFAULT_AI_PLAN_LIMITS.free) : DEFAULT_AI_PLAN_LIMITS.free,
    starter: "starter" in obj
      ? numOrNull(obj.starter, DEFAULT_AI_PLAN_LIMITS.starter)
      : (numOrNull(obj.standard, DEFAULT_AI_PLAN_LIMITS.starter) ?? DEFAULT_AI_PLAN_LIMITS.starter),
    business: "business" in obj
      ? numOrNull(obj.business, DEFAULT_AI_PLAN_LIMITS.business)
      : (numOrNull(obj.premium, DEFAULT_AI_PLAN_LIMITS.business) ?? DEFAULT_AI_PLAN_LIMITS.business),
    enterprise: "enterprise" in obj ? numOrNull(obj.enterprise, null) : DEFAULT_AI_PLAN_LIMITS.enterprise,
  };
}

/** null = unlimited (enterprise / custom). */
export function resolveAiPlanRequestLimit(
  planCode: string | null | undefined,
  planLimits: AiPlanLimits = DEFAULT_AI_PLAN_LIMITS,
): number | null {
  const key = mapWakaPlanToAiPlanCode(planCode);
  return planLimits[key];
}
