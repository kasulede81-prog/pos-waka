import type { AiFeatureName } from "./aiFeatures";
import {
  DEFAULT_PLATFORM_AI_SETTINGS_V2,
  isFeatureEnabledInSettings,
  type PlatformAiSettingsV2,
} from "./platformAiSettings.v2";

export type AiBlockCode =
  | "ai_platform_disabled"
  | "feature_disabled"
  | "monthly_request_limit_reached"
  | "monthly_budget_limit_reached"
  | "per_shop_limit_reached"
  | "per_user_limit_reached"
  | "provider_not_configured"
  | "feature_not_deployed";

export type CanUseAiResult =
  | { allowed: true }
  | { allowed: false; reason: string; code: AiBlockCode };

export type AiUsageSnapshot = {
  monthlyRequests?: number;
  monthlyProviderCostUsd?: number;
  shopRequests?: number;
  userRequests?: number;
};

/**
 * Synchronous permission check for UI gating.
 * Limit enforcement is authoritative on the server (edge + check_ai_feature_allowed RPC).
 */
export function canUseAi(
  feature: AiFeatureName,
  options?: {
    settings?: PlatformAiSettingsV2;
    usage?: AiUsageSnapshot;
    isCacheHit?: boolean;
    requireDeployed?: boolean;
  },
): CanUseAiResult {
  const settings = options?.settings ?? DEFAULT_PLATFORM_AI_SETTINGS_V2;
  const requireDeployed = options?.requireDeployed !== false;

  if (!settings.enabled) {
    return { allowed: false, reason: "AI platform is disabled.", code: "ai_platform_disabled" };
  }

  if (!isFeatureEnabledInSettings(settings, feature)) {
    return { allowed: false, reason: "AI feature disabled", code: "feature_disabled" };
  }

  if (settings.provider !== "deepseek") {
    return { allowed: false, reason: "AI provider is not configured.", code: "provider_not_configured" };
  }

  const usage = options?.usage;
  if (usage?.monthlyRequests != null && usage.monthlyRequests >= settings.monthly_request_limit) {
    return { allowed: false, reason: "Monthly request limit reached", code: "monthly_request_limit_reached" };
  }

  const isCacheHit = options?.isCacheHit === true;
  if (!isCacheHit && usage) {
    if (
      usage.monthlyProviderCostUsd != null &&
      usage.monthlyProviderCostUsd >= settings.monthly_budget_limit
    ) {
      return {
        allowed: false,
        reason: "Monthly budget limit reached",
        code: "monthly_budget_limit_reached",
      };
    }
    if (usage.shopRequests != null && usage.shopRequests >= settings.per_shop_limit) {
      return { allowed: false, reason: "Shop monthly limit reached", code: "per_shop_limit_reached" };
    }
    if (usage.userRequests != null && usage.userRequests >= settings.per_user_limit) {
      return { allowed: false, reason: "User monthly limit reached", code: "per_user_limit_reached" };
    }
  }

  void requireDeployed;
  return { allowed: true };
}

export function canUseAiAllowed(feature: AiFeatureName, settings?: PlatformAiSettingsV2): boolean {
  return canUseAi(feature, { settings }).allowed;
}
