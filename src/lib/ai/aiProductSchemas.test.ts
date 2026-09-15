import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_AI_SETTINGS,
  isAiProductAssistantActive,
  isAiBusinessSetupActive,
  isAiInventoryAssistantActive,
  normalizeProductNameKey,
  parseAiProductSuggestion,
  parsePlatformAiSettings,
} from "./aiProductSchemas";

describe("normalizeProductNameKey", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeProductNameKey("  Coca   Cola  500ml ")).toBe("coca cola 500ml");
  });

  it("strips punctuation for cache matching", () => {
    expect(normalizeProductNameKey("Coca-Cola (500ml)")).toBe("coca cola 500ml");
  });
});

describe("parsePlatformAiSettings", () => {
  it("defaults to safe off state", () => {
    const s = parsePlatformAiSettings(null);
    expect(s.enabled).toBe(false);
    expect(s.product_assistant).toBe(false);
    expect(s.schema_version).toBe(2);
  });

  it("merges v2 settings", () => {
    const s = parsePlatformAiSettings({
      enabled: true,
      product_assistant: true,
      monthly_request_limit: 100,
    });
    expect(s.enabled).toBe(true);
    expect(s.product_assistant).toBe(true);
    expect(s.monthly_request_limit).toBe(100);
    expect(s.business_setup_assistant).toBe(false);
  });

  it("reads legacy v1 keys", () => {
    const s = parsePlatformAiSettings({
      ai_enabled: true,
      ai_product_assistant_enabled: true,
      monthly_ai_generation_limit: 250,
    });
    expect(s.enabled).toBe(true);
    expect(s.product_assistant).toBe(true);
    expect(s.monthly_request_limit).toBe(250);
  });

  it("gates features via canUse helpers", () => {
    expect(isAiProductAssistantActive({ ...DEFAULT_PLATFORM_AI_SETTINGS, enabled: true })).toBe(false);
    expect(
      isAiProductAssistantActive({
        ...DEFAULT_PLATFORM_AI_SETTINGS,
        enabled: true,
        product_assistant: true,
      }),
    ).toBe(true);
    expect(isAiBusinessSetupActive({ ...DEFAULT_PLATFORM_AI_SETTINGS, enabled: true })).toBe(false);
    expect(
      isAiInventoryAssistantActive({
        ...DEFAULT_PLATFORM_AI_SETTINGS,
        enabled: true,
        inventory_assistant: true,
      }),
    ).toBe(true);
  });
});

describe("parseAiProductSuggestion", () => {
  it("parses Coca Cola example", () => {
    const s = parseAiProductSuggestion(
      {
        name: "Coca Cola 500ml",
        category: "Soda",
        unit: "Bottle",
        sellingMode: "unit",
        packType: "Crate",
        piecesPerPack: 24,
        confidence: 0.9,
      },
      "fallback",
    );
    expect(s?.name).toBe("Coca Cola 500ml");
    expect(s?.category).toBe("Soda");
    expect(s?.unit).toBe("bottle");
    expect(s?.packType).toBe("crate");
    expect(s?.piecesPerPack).toBe(24);
  });

  it("returns null for empty name", () => {
    expect(parseAiProductSuggestion({ name: "  " }, "x")).toBeNull();
  });
});
