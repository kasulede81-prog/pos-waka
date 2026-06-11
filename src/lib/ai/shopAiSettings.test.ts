import { describe, expect, it } from "vitest";
import { canUseAi } from "./canUseAi";
import { DEFAULT_PLATFORM_AI_SETTINGS_V2 } from "./platformAiSettings.v2";
import { parseShopAiSettings } from "./shopAiSettings";

const platformOn = {
  ...DEFAULT_PLATFORM_AI_SETTINGS_V2,
  enabled: true,
  product_assistant: true,
};

describe("parseShopAiSettings", () => {
  it("parses shop row", () => {
    const s = parseShopAiSettings(
      {
        shop_id: "abc",
        ai_enabled: true,
        product_assistant: true,
        monthly_request_limit: 250,
      },
      "abc",
    );
    expect(s?.ai_enabled).toBe(true);
    expect(s?.product_assistant).toBe(true);
    expect(s?.monthly_request_limit).toBe(250);
  });
});

describe("canUseAi shop hierarchy", () => {
  it("blocks when shop ai disabled", () => {
    const shop = parseShopAiSettings(
      { shop_id: "s1", ai_enabled: false, product_assistant: true },
      "s1",
    );
    const r = canUseAi("product_assistant", { settings: platformOn, shopSettings: shop });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("shop_ai_disabled");
  });

  it("blocks when shop feature disabled", () => {
    const shop = parseShopAiSettings(
      { shop_id: "s1", ai_enabled: true, product_assistant: false },
      "s1",
    );
    const r = canUseAi("product_assistant", { settings: platformOn, shopSettings: shop });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("shop_feature_disabled");
  });

  it("allows when no shop row and pilot off", () => {
    const r = canUseAi("product_assistant", { settings: platformOn, shopSettings: null });
    expect(r.allowed).toBe(true);
  });

  it("blocks pilot when shop not approved", () => {
    const r = canUseAi("product_assistant", {
      settings: { ...platformOn, pilot_rollout_mode: true },
      shopSettings: null,
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("pilot_not_approved");
  });

  it("blocks when shop monthly limit reached", () => {
    const shop = parseShopAiSettings(
      { shop_id: "s1", ai_enabled: true, product_assistant: true, monthly_request_limit: 100 },
      "s1",
    );
    const r = canUseAi("product_assistant", {
      settings: platformOn,
      shopSettings: shop,
      usage: { shopRequests: 100 },
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("shop_monthly_limit_reached");
  });
});
