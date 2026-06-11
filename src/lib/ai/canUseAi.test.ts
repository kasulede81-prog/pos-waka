import { describe, expect, it } from "vitest";
import { canUseAi } from "./canUseAi";
import { DEFAULT_PLATFORM_AI_SETTINGS_V2 } from "./platformAiSettings.v2";

describe("canUseAi", () => {
  it("blocks when platform disabled", () => {
    const r = canUseAi("product_assistant", { settings: DEFAULT_PLATFORM_AI_SETTINGS_V2 });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("ai_platform_disabled");
  });

  it("blocks when feature disabled", () => {
    const r = canUseAi("product_assistant", {
      settings: { ...DEFAULT_PLATFORM_AI_SETTINGS_V2, enabled: true },
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("feature_disabled");
  });

  it("allows when platform and feature enabled", () => {
    const r = canUseAi("product_assistant", {
      settings: {
        ...DEFAULT_PLATFORM_AI_SETTINGS_V2,
        enabled: true,
        product_assistant: true,
      },
    });
    expect(r.allowed).toBe(true);
  });

  it("blocks when monthly request limit reached", () => {
    const r = canUseAi("inventory_assistant", {
      settings: {
        ...DEFAULT_PLATFORM_AI_SETTINGS_V2,
        enabled: true,
        inventory_assistant: true,
        monthly_request_limit: 100,
      },
      usage: { monthlyRequests: 100 },
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("monthly_request_limit_reached");
  });
});
