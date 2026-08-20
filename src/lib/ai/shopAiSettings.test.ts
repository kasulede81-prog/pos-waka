import { describe, expect, it } from "vitest";
import { canUseAi } from "./canUseAi";
import { DEFAULT_PLATFORM_AI_SETTINGS_V2 } from "./platformAiSettings.v2";
import { parseShopAiSettings, isAskWakaPilotShopReady, hasShopAiSettingsRow } from "./shopAiSettings";

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

  it("gates ask_waka via shop settings", () => {
    const platformAsk = { ...platformOn, ask_waka: true };
    const shopOff = parseShopAiSettings(
      { shop_id: "s1", ai_enabled: true, ask_waka: false },
      "s1",
    );
    const blocked = canUseAi("ask_waka", { settings: platformAsk, shopSettings: shopOff, userRole: "owner" });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.code).toBe("shop_feature_disabled");

    const shopOn = parseShopAiSettings(
      { shop_id: "s1", ai_enabled: true, ask_waka: true },
      "s1",
    );
    expect(canUseAi("ask_waka", { settings: platformAsk, shopSettings: shopOn, userRole: "owner" }).allowed).toBe(true);
  });

  it("keeps Ask WAKA off when the platform flag is false even if the shop is on", () => {
    const shopOn = parseShopAiSettings(
      { shop_id: "s1", ai_enabled: true, ask_waka: true },
      "s1",
    );
    const r = canUseAi("ask_waka", {
      settings: { ...platformOn, ask_waka: false },
      shopSettings: shopOn,
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("feature_disabled");
  });

  it("fails closed when the shop row is missing", () => {
    const platformAsk = { ...platformOn, ask_waka: true };
    const missing = canUseAi("ask_waka", {
      settings: platformAsk,
      shopSettings: null,
      userRole: "owner",
    });
    expect(missing.allowed).toBe(false);
    if (!missing.allowed) expect(missing.code).toBe("shop_not_authorized");
    expect(hasShopAiSettingsRow(null)).toBe(false);
    expect(isAskWakaPilotShopReady(null)).toBe(false);
    expect(
      isAskWakaPilotShopReady(
        parseShopAiSettings({ shop_id: "s1", ai_enabled: true, ask_waka: false }, "s1"),
      ),
    ).toBe(false);
    expect(
      isAskWakaPilotShopReady(
        parseShopAiSettings({ shop_id: "s1", ai_enabled: true, ask_waka: true }, "s1"),
      ),
    ).toBe(true);
  });

  it("blocks when no shop row even if pilot is off", () => {
    const r = canUseAi("product_assistant", {
      settings: platformOn,
      shopSettings: null,
      userRole: "owner",
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("shop_not_authorized");
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
      userRole: "owner",
      usage: { shopRequests: 100 },
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("shop_monthly_limit_reached");
  });
});
