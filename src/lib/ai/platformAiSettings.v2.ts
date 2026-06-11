import type { AiFeatureName } from "./aiFeatures";

export type AiProviderName = "deepseek" | "openai" | "gemini" | "claude";

export type DeepSeekModel = "deepseek-chat" | "deepseek-reasoner";

export const DEEPSEEK_MODEL_OPTIONS: DeepSeekModel[] = ["deepseek-chat", "deepseek-reasoner"];

export const AI_PROVIDER_OPTIONS: AiProviderName[] = ["deepseek", "openai", "gemini", "claude"];

export type PlatformAiSettingsV2 = {
  schema_version: 2;
  enabled: boolean;
  provider: AiProviderName;
  provider_config: {
    deepseek_model?: DeepSeekModel;
  };
  product_assistant: boolean;
  product_scanner: boolean;
  ocr: boolean;
  barcode_detection: boolean;
  business_setup_assistant: boolean;
  inventory_assistant: boolean;
  restock_suggestions: boolean;
  marketing_assistant: boolean;
  marketplace_assistant: boolean;
  monthly_request_limit: number;
  monthly_budget_limit: number;
  per_shop_limit: number;
  per_user_limit: number;
};

export const DEFAULT_PLATFORM_AI_SETTINGS_V2: PlatformAiSettingsV2 = {
  schema_version: 2,
  enabled: false,
  provider: "deepseek",
  provider_config: { deepseek_model: "deepseek-chat" },
  product_assistant: false,
  product_scanner: false,
  ocr: false,
  barcode_detection: false,
  business_setup_assistant: false,
  inventory_assistant: false,
  restock_suggestions: false,
  marketing_assistant: false,
  marketplace_assistant: false,
  monthly_request_limit: 20000,
  monthly_budget_limit: 50,
  per_shop_limit: 500,
  per_user_limit: 100,
};

function boolField(obj: Record<string, unknown>, ...keys: string[]): boolean {
  for (const k of keys) {
    if (obj[k] === true) return true;
    if (obj[k] === false) return false;
  }
  return false;
}

function numField(obj: Record<string, unknown>, key: string, fallback: number): number {
  const v = Number(obj[key]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

export function isFeatureEnabledInSettings(settings: PlatformAiSettingsV2, feature: AiFeatureName): boolean {
  return settings[feature] === true;
}

export function deepseekModelFromSettings(settings: PlatformAiSettingsV2): DeepSeekModel {
  const m = settings.provider_config?.deepseek_model;
  return m === "deepseek-reasoner" ? "deepseek-reasoner" : "deepseek-chat";
}

/** Parse platform AI settings with legacy v1 key compatibility. */
export function parsePlatformAiSettingsV2(raw: unknown): PlatformAiSettingsV2 {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const providerConfig =
    obj.provider_config && typeof obj.provider_config === "object"
      ? (obj.provider_config as Record<string, unknown>)
      : {};

  const providerRaw = String(obj.provider ?? "deepseek").toLowerCase();
  const provider = AI_PROVIDER_OPTIONS.includes(providerRaw as AiProviderName)
    ? (providerRaw as AiProviderName)
    : "deepseek";

  const modelRaw = String(providerConfig.deepseek_model ?? obj.deepseek_model ?? "deepseek-chat");
  const deepseek_model: DeepSeekModel = modelRaw === "deepseek-reasoner" ? "deepseek-reasoner" : "deepseek-chat";

  const enabled = boolField(obj, "enabled", "ai_enabled");

  return {
    schema_version: 2,
    enabled,
    provider,
    provider_config: { deepseek_model },
    product_assistant: boolField(obj, "product_assistant", "ai_product_assistant_enabled"),
    product_scanner: obj.product_scanner === true,
    ocr: obj.ocr === true,
    barcode_detection: obj.barcode_detection === true,
    business_setup_assistant: boolField(obj, "business_setup_assistant", "ai_business_setup_enabled"),
    inventory_assistant: obj.inventory_assistant === true,
    restock_suggestions: obj.restock_suggestions === true,
    marketing_assistant: obj.marketing_assistant === true,
    marketplace_assistant: obj.marketplace_assistant === true,
    monthly_request_limit: numField(
      obj,
      "monthly_request_limit",
      numField(obj, "monthly_ai_generation_limit", DEFAULT_PLATFORM_AI_SETTINGS_V2.monthly_request_limit),
    ),
    monthly_budget_limit: numField(obj, "monthly_budget_limit", DEFAULT_PLATFORM_AI_SETTINGS_V2.monthly_budget_limit),
    per_shop_limit: numField(obj, "per_shop_limit", DEFAULT_PLATFORM_AI_SETTINGS_V2.per_shop_limit),
    per_user_limit: numField(obj, "per_user_limit", DEFAULT_PLATFORM_AI_SETTINGS_V2.per_user_limit),
  };
}

export function settingsToAdminPayload(settings: PlatformAiSettingsV2): Record<string, unknown> {
  return { ...settings };
}
