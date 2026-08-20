import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_OPTIONS,
  DEFAULT_PLATFORM_AI_SETTINGS_V2,
  DEFAULT_PRODUCTION_AI_PROVIDER,
  PRODUCTION_AI_PROVIDER_OPTIONS,
  PRODUCTION_SUPABASE_PROJECT_REF,
  adminSelectableAiProviders,
  coerceAdminSelectableProvider,
  isOllamaProviderSelectable,
  isProductionSupabaseTarget,
  parsePlatformAiSettingsV2,
  settingsToAdminPayload,
} from "./platformAiSettings.v2";

const PROD_URL = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
const STAGING_URL = "https://wdirxwvbgsfzbdurmkbf.supabase.co";

describe("parsePlatformAiSettingsV2", () => {
  it("maps legacy keys", () => {
    const s = parsePlatformAiSettingsV2({
      ai_enabled: true,
      ai_business_setup_enabled: true,
      ai_product_assistant_enabled: false,
      deepseek_model: "deepseek-reasoner",
      monthly_ai_generation_limit: 8000,
    });
    expect(s.enabled).toBe(true);
    expect(s.business_setup_assistant).toBe(true);
    expect(s.product_assistant).toBe(false);
    expect(s.provider_config.deepseek_model).toBe("deepseek-reasoner");
    expect(s.monthly_request_limit).toBe(8000);
  });

  it("defaults Ask WAKA and pilot flags off with DeepSeek", () => {
    const s = parsePlatformAiSettingsV2({});
    expect(s.provider).toBe("deepseek");
    expect(s.ask_waka).toBe(false);
    expect(s.pilot_rollout_mode).toBe(false);
    expect(s.pilot_auto_enable_new_shops).toBe(false);
    expect(s.role_access.cashier).toBe(false);
    expect(s.role_access.owner).toBe(true);
    expect(DEFAULT_PLATFORM_AI_SETTINGS_V2.ask_waka).toBe(false);
    expect(DEFAULT_PLATFORM_AI_SETTINGS_V2.provider).toBe(DEFAULT_PRODUCTION_AI_PROVIDER);
  });
});

describe("production AI provider isolation", () => {
  it("keeps DeepSeek as the production default", () => {
    expect(DEFAULT_PRODUCTION_AI_PROVIDER).toBe("deepseek");
    expect(PRODUCTION_AI_PROVIDER_OPTIONS).toEqual(["deepseek"]);
    expect(PRODUCTION_AI_PROVIDER_OPTIONS).not.toContain("openai");
  });

  it("keeps Ollama in the architecture list for local development", () => {
    expect(AI_PROVIDER_OPTIONS).toContain("ollama");
    expect(AI_PROVIDER_OPTIONS).toContain("deepseek");
  });

  it("never treats the production project as an Ollama-selectable target", () => {
    expect(isProductionSupabaseTarget(PROD_URL)).toBe(true);
    expect(isProductionSupabaseTarget(STAGING_URL)).toBe(false);
    expect(
      isOllamaProviderSelectable({
        DEV: true,
        VITE_ALLOW_OLLAMA_PROVIDER: "true",
        VITE_SUPABASE_URL: PROD_URL,
      }),
    ).toBe(false);
  });

  it("hides Ollama from production admin configuration", () => {
    const env = { PROD: true, DEV: false, VITE_SUPABASE_URL: PROD_URL };
    expect(adminSelectableAiProviders(env)).not.toContain("ollama");
    expect(adminSelectableAiProviders(env)).toEqual(["deepseek"]);
    expect(coerceAdminSelectableProvider("ollama", env)).toBe("deepseek");
    expect(coerceAdminSelectableProvider("deepseek", env)).toBe("deepseek");
    expect(coerceAdminSelectableProvider("openai", env)).toBe("deepseek");
  });

  it("still offers Ollama in local development against a non-production target", () => {
    const env = { DEV: true, PROD: false, VITE_SUPABASE_URL: STAGING_URL };
    expect(isOllamaProviderSelectable(env)).toBe(true);
    expect(adminSelectableAiProviders(env)).toContain("ollama");
    expect(adminSelectableAiProviders(env)).not.toContain("openai");
    expect(coerceAdminSelectableProvider("ollama", env)).toBe("ollama");
  });

  it("allows an explicit non-production override", () => {
    const env = {
      PROD: true,
      DEV: false,
      VITE_ALLOW_OLLAMA_PROVIDER: "true",
      VITE_SUPABASE_URL: STAGING_URL,
    };
    expect(isOllamaProviderSelectable(env)).toBe(true);
    expect(adminSelectableAiProviders(env)).toContain("ollama");
  });

  it("strips Ollama from production admin save payloads", () => {
    const payload = settingsToAdminPayload(
      {
        ...DEFAULT_PLATFORM_AI_SETTINGS_V2,
        provider: "ollama",
        provider_config: {
          deepseek_model: "deepseek-chat",
          ollama_base_url: "http://127.0.0.1:11434",
          ollama_model: "qwen3:4b",
        },
      },
      { PROD: true, DEV: false, VITE_SUPABASE_URL: PROD_URL },
    );
    expect(payload.provider).toBe("deepseek");
    expect((payload.provider_config as { ollama_base_url?: string }).ollama_base_url).toBeUndefined();
    expect((payload.provider_config as { ollama_model?: string }).ollama_model).toBeUndefined();
  });

  it("preserves Ollama fields when saving in local development", () => {
    const payload = settingsToAdminPayload(
      {
        ...DEFAULT_PLATFORM_AI_SETTINGS_V2,
        provider: "ollama",
        provider_config: {
          ollama_base_url: "http://127.0.0.1:11434",
          ollama_model: "qwen3:4b",
        },
      },
      { DEV: true, PROD: false, VITE_SUPABASE_URL: STAGING_URL },
    );
    expect(payload.provider).toBe("ollama");
    expect((payload.provider_config as { ollama_base_url?: string }).ollama_base_url).toBe(
      "http://127.0.0.1:11434",
    );
  });

  it("forces coming-soon feature flags off on save", () => {
    const payload = settingsToAdminPayload({
      ...DEFAULT_PLATFORM_AI_SETTINGS_V2,
      marketing_assistant: true,
      product_scanner: true,
      ocr: true,
    });
    expect(payload.marketing_assistant).toBe(false);
    expect(payload.product_scanner).toBe(false);
    expect(payload.ocr).toBe(false);
    expect(payload.provider).toBe("deepseek");
  });
});
