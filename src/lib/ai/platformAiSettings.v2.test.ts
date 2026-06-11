import { describe, expect, it } from "vitest";
import { parsePlatformAiSettingsV2 } from "./platformAiSettings.v2";

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
});
