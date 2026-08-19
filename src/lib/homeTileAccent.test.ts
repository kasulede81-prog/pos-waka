import { describe, expect, it } from "vitest";
import {
  hexContrastRatio,
  readableOnHex,
  resolveHomeTileAccent,
} from "./homeTileAccent";
import { PRESET_SHELF_HEX } from "./shelfColor";
import { resolveHomeMenuTiles, updateLauncherTileLayout } from "./launcherTiles";
import { resolveHomePresentation } from "./homePresentation";

const allowAll = () => true;

describe("resolveHomeTileAccent", () => {
  it("A — blue preset stores existing color representation and resolves PRESET_SHELF_HEX.blue", () => {
    const layout = updateLauncherTileLayout({}, "inventory", { color: "blue", customColor: null });
    expect(layout.inventory?.color).toBe("blue");
    expect(layout.inventory?.customColor).toBeNull();
    const { secondary } = resolveHomeMenuTiles({
      savedOrder: ["inventory"],
      layout,
      hasPermission: allowAll,
    });
    const tile = secondary.find((t) => t.id === "inventory");
    const accent = resolveHomeTileAccent(tile!);
    expect(accent.source).toBe("preset");
    expect(accent.preset).toBe("blue");
    expect(accent.hex).toBe(PRESET_SHELF_HEX.blue);
    expect(accent.wellStyle.backgroundColor).toBe(PRESET_SHELF_HEX.blue);
  });

  it("B — custom HEX persists as customColor and wins over preset", () => {
    const layout = updateLauncherTileLayout({}, "debts", { color: "green", customColor: "#3366cc" });
    expect(layout.debts?.customColor).toBe("#3366cc");
    const accent = resolveHomeTileAccent({
      color: layout.debts?.color,
      customColor: layout.debts?.customColor,
    });
    expect(accent.source).toBe("custom");
    expect(accent.hex).toBe("#3366cc");
  });

  it("C/D — live Home and Settings preview share the same accent resolver", () => {
    const layout = { cash: { color: "red" as const, customColor: null } };
    const live = resolveHomePresentation({
      savedOrder: ["cash"],
      layout,
      hasPermission: allowAll,
      includeHidden: false,
    });
    const settings = resolveHomePresentation({
      savedOrder: ["cash"],
      layout,
      hasPermission: allowAll,
      includeHidden: true,
    });
    const liveCash = live.primary.find((t) => t.id === "cash");
    const previewCash = settings.primary.find((t) => t.id === "cash");
    expect(resolveHomeTileAccent(liveCash!)).toEqual(resolveHomeTileAccent(previewCash!));
    expect(resolveHomeTileAccent(liveCash!).hex).toBe(PRESET_SHELF_HEX.red);
  });

  it("E — independent per-tile accents (inventory blue, debts green, reports purple)", () => {
    const layout = {
      inventory: { color: "blue" as const, customColor: null },
      debts: { color: "green" as const, customColor: null },
      reports: { color: "purple" as const, customColor: null },
    };
    const presentation = resolveHomePresentation({
      savedOrder: ["inventory", "debts", "reports"],
      layout,
      hasPermission: allowAll,
    });
    expect(resolveHomeTileAccent(presentation.primary.find((t) => t.id === "inventory")!).hex).toBe(
      PRESET_SHELF_HEX.blue,
    );
    expect(resolveHomeTileAccent(presentation.secondary.find((t) => t.id === "debts")!).hex).toBe(
      PRESET_SHELF_HEX.green,
    );
    expect(resolveHomeTileAccent(presentation.reports!).hex).toBe(PRESET_SHELF_HEX.purple);
  });

  it("F — existing saved customColor displays without re-saving", () => {
    const accent = resolveHomeTileAccent({ color: "green", customColor: "#0d9488" });
    expect(accent.hex).toBe("#0d9488");
    expect(accent.source).toBe("custom");
  });

  it("G — accent hex is inline and independent of dark-mode --card", () => {
    const accent = resolveHomeTileAccent({ color: "orange", customColor: null });
    expect(accent.wellStyle.backgroundColor).toBe(PRESET_SHELF_HEX.orange);
    expect(accent.railStyle.backgroundColor).toBe(PRESET_SHELF_HEX.orange);
    expect(JSON.stringify(accent.wellStyle)).not.toContain("card");
  });

  it("H — very light and very dark fills get a readable icon color", () => {
    const light = readableOnHex("#fde047");
    const dark = readableOnHex("#0a1628");
    expect(light).toBe("#1c1917");
    expect(dark).toBe("#ffffff");
    expect(hexContrastRatio("#fde047", light)).toBeGreaterThanOrEqual(4.5);
    expect(hexContrastRatio("#0a1628", dark)).toBeGreaterThanOrEqual(4.5);
    for (const hex of Object.values(PRESET_SHELF_HEX)) {
      const icon = readableOnHex(hex);
      expect(hexContrastRatio(hex, icon)).toBeGreaterThanOrEqual(3);
    }
  });

  it("I — homeHeroPreviewBgColor is not an input to tile accent", () => {
    const withoutHero = resolveHomeTileAccent({ color: "blue", customColor: null });
    const withUnusedHeroNearby = resolveHomeTileAccent({ color: "blue", customColor: null });
    expect(withoutHero.hex).toBe(withUnusedHeroNearby.hex);
    expect(withoutHero.hex).not.toBe("#ecfdf5");
  });

  it("J — Sell stays hero and is not a band tile", () => {
    const presentation = resolveHomePresentation({
      savedOrder: ["inventory"],
      layout: { sell: { color: "purple", customColor: "#7c3aed" } },
      hasPermission: allowAll,
    });
    expect(presentation.hero?.id).toBe("sell");
    expect(presentation.primary.map((t) => t.id)).not.toContain("sell");
    expect(presentation.secondary.map((t) => t.id)).not.toContain("sell");
    expect(presentation.admin.map((t) => t.id)).not.toContain("sell");
  });
});
