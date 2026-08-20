import { isLiveAiFeature, type AiFeatureName } from "./aiFeatures";
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
import { DEFAULT_AI_ROLE_ACCESS, isAiRoleAuthorized, type AiRoleAccess } from "./aiAuthorization";
import { resolveAiPlanRequestLimit } from "./aiPlanEntitlements";
import type { UserRole } from "../../types";

export type AiBlockCode =
  | "ai_platform_disabled"
  | "feature_disabled"
  | "pilot_not_approved"
  | "shop_ai_disabled"
  | "shop_not_authorized"
  | "shop_feature_disabled"
  | "user_not_authorized"
  | "shop_monthly_limit_reached"
  | "plan_limit_reached"
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
    userRole?: UserRole | string | null;
    roleAccess?: AiRoleAccess;
    wakaPlanCode?: string | null;
    usage?: AiUsageSnapshot;
    isCacheHit?: boolean;
    requireDeployed?: boolean;
  },
): CanUseAiResult {
  const settings = options?.settings ?? DEFAULT_PLATFORM_AI_SETTINGS_V2;
  const shopSettings = options?.shopSettings;
  const hasShopRow = hasShopAiSettingsRow(shopSettings);
  const requireDeployed = options?.requireDeployed !== false;
  const roleAccess = options?.roleAccess ?? settings.role_access ?? DEFAULT_AI_ROLE_ACCESS;

  if (!settings.enabled) {
    return { allowed: false, reason: "AI platform is disabled.", code: "ai_platform_disabled" };
  }

  if (requireDeployed && !isLiveAiFeature(feature)) {
    return { allowed: false, reason: "AI feature is not deployed.", code: "feature_not_deployed" };
  }

  if (!isFeatureEnabledInSettings(settings, feature)) {
    return { allowed: false, reason: "AI feature disabled", code: "feature_disabled" };
  }

  if (!hasShopRow) {
    return {
      allowed: false,
      reason: "Shop is not authorized for AI",
      code: settings.pilot_rollout_mode ? "pilot_not_approved" : "shop_not_authorized",
    };
  }

  if (!shopSettings.ai_enabled) {
    return {
      allowed: false,
      reason: settings.pilot_rollout_mode ? "Shop is not approved for AI pilot" : "Shop AI disabled",
      code: settings.pilot_rollout_mode ? "pilot_not_approved" : "shop_ai_disabled",
    };
  }

  if (!isFeatureEnabledInShopSettings(shopSettings, feature)) {
    return {
      allowed: false,
      reason: "AI feature disabled for this shop",
      code: "shop_feature_disabled",
    };
  }

  if (!isAiRoleAuthorized(options?.userRole, roleAccess)) {
    return { allowed: false, reason: "Your role is not authorized for AI", code: "user_not_authorized" };
  }

  if (settings.provider !== "deepseek") {
    return { allowed: false, reason: "AI provider is not configured.", code: "provider_not_configured" };
  }

  const usage = options?.usage;
  const shopLimit = shopSettings.monthly_request_limit;
  if (shopLimit > 0 && usage?.shopRequests != null && usage.shopRequests >= shopLimit) {
    return {
      allowed: false,
      reason: "Shop monthly AI limit reached",
      code: "shop_monthly_limit_reached",
    };
  }

  const planSource = options?.wakaPlanCode ?? shopSettings.plan_code;
  if (planSource) {
    const planCap = resolveAiPlanRequestLimit(planSource, settings.plan_limits);
    if (planCap != null && usage?.shopRequests != null && usage.shopRequests >= planCap) {
      return {
        allowed: false,
        reason: "Plan AI request limit reached",
        code: "plan_limit_reached",
      };
    }
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

  return { allowed: true };
}

export function canUseAiAllowed(
  feature: AiFeatureName,
  settings?: PlatformAiSettingsV2,
  shopSettings?: ShopAiSettings | null,
  userRole?: UserRole | string | null,
): boolean {
  return canUseAi(feature, { settings, shopSettings, userRole }).allowed;
}
