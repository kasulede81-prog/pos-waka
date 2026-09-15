import type { AiFeatureName } from "./aiFeatures";
import {
  DEFAULT_PLATFORM_AI_SETTINGS_V2,
  isFeatureEnabledInSettings,
  type PlatformAiSettingsV2,
} from "./platformAiSettings.v2";
import {
  hasShopAiSettingsRow,
  isFeatureEnabledInShopSettings,
  type ShopAiSettings,
} from "./shopAiSettings";

export type AiBlockCode =
  | "ai_platform_disabled"
  | "feature_disabled"
  | "pilot_not_approved"
  | "shop_ai_disabled"
  | "shop_feature_disabled"
  | "shop_monthly_limit_reached"
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
 * Synchronous permission check for UI gating (L1–L7).
 * Authoritative enforcement: edge + check_ai_feature_allowed RPC.
 */
export function canUseAi(
  feature: AiFeatureName,
  options?: {
    settings?: PlatformAiSettingsV2;
    shopSettings?: ShopAiSettings | null;
    usage?: AiUsageSnapshot;
    isCacheHit?: boolean;
    requireDeployed?: boolean;
  },
): CanUseAiResult {
  const settings = options?.settings ?? DEFAULT_PLATFORM_AI_SETTINGS_V2;
  const shopSettings = options?.shopSettings;
  const hasShopRow = hasShopAiSettingsRow(shopSettings);
  const requireDeployed = options?.requireDeployed !== false;

  if (!settings.enabled) {
    return { allowed: false, reason: "AI platform is disabled.", code: "ai_platform_disabled" };
  }

  if (!isFeatureEnabledInSettings(settings, feature)) {
    return { allowed: false, reason: "AI feature disabled", code: "feature_disabled" };
  }

  if (settings.pilot_rollout_mode) {
    if (!hasShopRow || !shopSettings.ai_enabled) {
      return {
        allowed: false,
        reason: "Shop is not approved for AI pilot",
        code: "pilot_not_approved",
      };
    }
  } else if (hasShopRow && !shopSettings.ai_enabled) {
    return { allowed: false, reason: "Shop AI disabled", code: "shop_ai_disabled" };
  }

  if (hasShopRow && !isFeatureEnabledInShopSettings(shopSettings, feature)) {
    return {
      allowed: false,
      reason: "AI feature disabled for this shop",
      code: "shop_feature_disabled",
    };
  }

  if (settings.provider !== "deepseek") {
    return { allowed: false, reason: "AI provider is not configured.", code: "provider_not_configured" };
  }

  const usage = options?.usage;
  const shopLimit = hasShopRow ? shopSettings.monthly_request_limit : 0;
  if (shopLimit > 0 && usage?.shopRequests != null && usage.shopRequests >= shopLimit) {
    return {
      allowed: false,
      reason: "Shop monthly AI limit reached",
      code: "shop_monthly_limit_reached",
    };
  }

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

export function canUseAiAllowed(
  feature: AiFeatureName,
  settings?: PlatformAiSettingsV2,
  shopSettings?: ShopAiSettings | null,
): boolean {
  return canUseAi(feature, { settings, shopSettings }).allowed;
}
