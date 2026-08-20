import { COMING_SOON_AI_FEATURES, type AiFeatureName } from "./aiFeatures";
import { DEFAULT_AI_PLAN_LIMITS, parseAiPlanLimits, type AiPlanLimits } from "./aiPlanEntitlements";
import { DEFAULT_AI_ROLE_ACCESS, parseAiRoleAccess, type AiRoleAccess } from "./aiAuthorization";

export type AiProviderName = "deepseek" | "ollama" | "openai" | "gemini" | "claude";

export type DeepSeekModel = "deepseek-chat" | "deepseek-reasoner";

export const DEEPSEEK_MODEL_OPTIONS: DeepSeekModel[] = ["deepseek-chat", "deepseek-reasoner"];

/**
 * Full provider architecture list (includes Ollama for local/dev).
 * Production admin UI must use `adminSelectableAiProviders()`, not this array.
 */
export const AI_PROVIDER_OPTIONS: AiProviderName[] = ["deepseek", "ollama", "openai", "gemini", "claude"];

/** Providers the Edge can actually call in production. Others are listed as unavailable. */
export const PRODUCTION_AI_PROVIDER_OPTIONS: AiProviderName[] = ["deepseek"];

/** Shown in admin as locked — no Edge client or secrets wired. */
export const UNAVAILABLE_PRODUCTION_AI_PROVIDERS: AiProviderName[] = ["openai", "gemini", "claude"];

export const DEFAULT_PRODUCTION_AI_PROVIDER: AiProviderName = "deepseek";

/** Production Supabase project ref — not a secret; used to refuse Ollama on that target. */
export const PRODUCTION_SUPABASE_PROJECT_REF = "ljaedextsenbkxzzgxcg";

export type AiProviderEnv = {
  DEV?: boolean;
  PROD?: boolean;
  VITE_ALLOW_OLLAMA_PROVIDER?: string;
  VITE_SUPABASE_URL?: string;
};

export function isProductionSupabaseTarget(url?: string): boolean {
  const u = String(url ?? "").toLowerCase();
  return u.includes(PRODUCTION_SUPABASE_PROJECT_REF);
}

function resolveAiProviderEnv(env?: AiProviderEnv): AiProviderEnv {
  if (env) return env;
  if (typeof import.meta !== "undefined" && import.meta.env) {
    return {
      DEV: import.meta.env.DEV === true,
      PROD: import.meta.env.PROD === true,
      VITE_ALLOW_OLLAMA_PROVIDER: String(import.meta.env.VITE_ALLOW_OLLAMA_PROVIDER ?? ""),
      VITE_SUPABASE_URL: String(import.meta.env.VITE_SUPABASE_URL ?? ""),
    };
  }
  return {};
}

/**
 * Whether the Internal Admin provider dropdown may offer Ollama.
 * Never on the production Supabase project. Local Vite `npm run dev` → true.
 * Production builds → false unless `VITE_ALLOW_OLLAMA_PROVIDER=true` AND the
 * target is not production.
 */
export function isOllamaProviderSelectable(env?: AiProviderEnv): boolean {
  const e = resolveAiProviderEnv(env);
  if (isProductionSupabaseTarget(e.VITE_SUPABASE_URL)) return false;
  if (String(e.VITE_ALLOW_OLLAMA_PROVIDER ?? "") === "true") return true;
  if (e.DEV === true) return true;
  if (e.PROD === true) return false;
  return false;
}

export function adminSelectableAiProviders(env?: AiProviderEnv): AiProviderName[] {
  const live: AiProviderName[] = [...PRODUCTION_AI_PROVIDER_OPTIONS];
  if (isOllamaProviderSelectable(env) && !live.includes("ollama")) live.push("ollama");
  return live;
}

/** Coerce a stored provider to one the current admin UI may save. */
export function coerceAdminSelectableProvider(provider: string, env?: AiProviderEnv): AiProviderName {
  const allowed = adminSelectableAiProviders(env);
  const raw = String(provider || "").toLowerCase() as AiProviderName;
  if (allowed.includes(raw)) return raw;
  return DEFAULT_PRODUCTION_AI_PROVIDER;
}

export type PlatformAiSettingsV2 = {
  schema_version: 2;
  enabled: boolean;
  provider: AiProviderName;
  provider_config: {
    deepseek_model?: DeepSeekModel;
    /** Staging/dev only — Edge-reachable Ollama base URL (not localhost on hosted Edge). */
    ollama_base_url?: string;
    ollama_model?: string;
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
  ask_waka: boolean;
  monthly_request_limit: number;
  monthly_budget_limit: number;
  per_shop_limit: number;
  per_user_limit: number;
  plan_limits: AiPlanLimits;
  role_access: AiRoleAccess;
  pilot_rollout_mode: boolean;
  pilot_auto_enable_new_shops: boolean;
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
  ask_waka: false,
  monthly_request_limit: 20000,
  monthly_budget_limit: 50,
  per_shop_limit: 500,
  per_user_limit: 100,
  plan_limits: { ...DEFAULT_AI_PLAN_LIMITS },
  role_access: { ...DEFAULT_AI_ROLE_ACCESS },
  pilot_rollout_mode: false,
  pilot_auto_enable_new_shops: false,
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
  const ollamaBase = String(providerConfig.ollama_base_url ?? "").trim();
  const ollamaModel = String(providerConfig.ollama_model ?? "").trim();

  const enabled = boolField(obj, "enabled", "ai_enabled");

  return {
    schema_version: 2,
    enabled,
    provider,
    provider_config: {
      deepseek_model,
      ...(ollamaBase ? { ollama_base_url: ollamaBase } : {}),
      ...(ollamaModel ? { ollama_model: ollamaModel } : {}),
    },
    product_assistant: boolField(obj, "product_assistant", "ai_product_assistant_enabled"),
    product_scanner: obj.product_scanner === true,
    ocr: obj.ocr === true,
    barcode_detection: obj.barcode_detection === true,
    business_setup_assistant: boolField(obj, "business_setup_assistant", "ai_business_setup_enabled"),
    inventory_assistant: obj.inventory_assistant === true,
    restock_suggestions: obj.restock_suggestions === true,
    marketing_assistant: obj.marketing_assistant === true,
    marketplace_assistant: obj.marketplace_assistant === true,
    ask_waka: obj.ask_waka === true,
    monthly_request_limit: numField(
      obj,
      "monthly_request_limit",
      numField(obj, "monthly_ai_generation_limit", DEFAULT_PLATFORM_AI_SETTINGS_V2.monthly_request_limit),
    ),
    monthly_budget_limit: numField(obj, "monthly_budget_limit", DEFAULT_PLATFORM_AI_SETTINGS_V2.monthly_budget_limit),
    per_shop_limit: numField(obj, "per_shop_limit", DEFAULT_PLATFORM_AI_SETTINGS_V2.per_shop_limit),
    per_user_limit: numField(obj, "per_user_limit", DEFAULT_PLATFORM_AI_SETTINGS_V2.per_user_limit),
    plan_limits: parseAiPlanLimits(obj.plan_limits),
    role_access: parseAiRoleAccess(obj.role_access),
    pilot_rollout_mode: obj.pilot_rollout_mode === true,
    pilot_auto_enable_new_shops: obj.pilot_auto_enable_new_shops === true,
  };
}

export function settingsToAdminPayload(
  settings: PlatformAiSettingsV2,
  env?: AiProviderEnv,
): Record<string, unknown> {
  const provider = coerceAdminSelectableProvider(settings.provider, env);
  const provider_config = { ...settings.provider_config };
  if (provider !== "ollama") {
    delete provider_config.ollama_base_url;
    delete provider_config.ollama_model;
  }
  const undeployedOff = Object.fromEntries(COMING_SOON_AI_FEATURES.map((k) => [k, false]));
  return { ...settings, ...undeployedOff, provider, provider_config };
}
