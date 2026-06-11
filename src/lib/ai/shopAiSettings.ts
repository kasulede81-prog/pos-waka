import type { AiFeatureName } from "./aiFeatures";

/** Features with per-shop toggles in shop_ai_settings. */
export const SHOP_MANAGED_AI_FEATURES = [
  "product_assistant",
  "business_setup_assistant",
  "inventory_assistant",
  "marketing_assistant",
  "marketplace_assistant",
] as const;

export type ShopManagedAiFeature = (typeof SHOP_MANAGED_AI_FEATURES)[number];

export type ShopAiPlanCode = "free" | "standard" | "premium" | "enterprise";

export type ShopAiSettings = {
  shop_id: string;
  ai_enabled: boolean;
  product_assistant: boolean;
  business_setup_assistant: boolean;
  inventory_assistant: boolean;
  marketing_assistant: boolean;
  marketplace_assistant: boolean;
  monthly_request_limit: number;
  plan_code: ShopAiPlanCode | null;
  created_at?: string;
  updated_at?: string;
};

export type ShopAiUsageSummary = {
  requests_this_month: number;
  last_activity_at: string | null;
};

export const DEFAULT_SHOP_AI_SETTINGS: Omit<ShopAiSettings, "shop_id"> = {
  ai_enabled: false,
  product_assistant: false,
  business_setup_assistant: false,
  inventory_assistant: false,
  marketing_assistant: false,
  marketplace_assistant: false,
  monthly_request_limit: 500,
  plan_code: null,
};

export function isShopManagedAiFeature(feature: AiFeatureName): feature is ShopManagedAiFeature {
  return (SHOP_MANAGED_AI_FEATURES as readonly string[]).includes(feature);
}

export function isFeatureEnabledInShopSettings(settings: ShopAiSettings, feature: AiFeatureName): boolean {
  if (!isShopManagedAiFeature(feature)) return true;
  return settings[feature] === true;
}

export function parseShopAiSettings(raw: unknown, shopIdFallback = ""): ShopAiSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const shopId = String(obj.shop_id ?? shopIdFallback).trim();
  if (!shopId) return null;

  const bool = (k: string) => obj[k] === true;

  const limitRaw = Number(obj.monthly_request_limit);
  const monthly_request_limit =
    Number.isFinite(limitRaw) && limitRaw >= 0 ? Math.floor(limitRaw) : DEFAULT_SHOP_AI_SETTINGS.monthly_request_limit;

  const planRaw = obj.plan_code != null ? String(obj.plan_code) : null;
  const plan_code =
    planRaw === "free" || planRaw === "standard" || planRaw === "premium" || planRaw === "enterprise"
      ? planRaw
      : null;

  return {
    shop_id: shopId,
    ai_enabled: bool("ai_enabled"),
    product_assistant: bool("product_assistant"),
    business_setup_assistant: bool("business_setup_assistant"),
    inventory_assistant: bool("inventory_assistant"),
    marketing_assistant: bool("marketing_assistant"),
    marketplace_assistant: bool("marketplace_assistant"),
    monthly_request_limit,
    plan_code,
    created_at: obj.created_at != null ? String(obj.created_at) : undefined,
    updated_at: obj.updated_at != null ? String(obj.updated_at) : undefined,
  };
}

export function hasShopAiSettingsRow(settings: ShopAiSettings | null | undefined): settings is ShopAiSettings {
  return settings != null && Boolean(settings.shop_id);
}
