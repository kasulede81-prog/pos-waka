import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAUNCHER_TILE_LAYOUT,
  DEFAULT_LAUNCHER_TILE_ORDER,
  mergeLauncherTileLayout,
  resolveHomeMenuTiles,
} from "./launcherTiles";
import { DEFAULT_OFFICE_HUB_TILE_LAYOUT, mergeOfficeHubTileLayout, resolveOfficeHubSections } from "./officeHubSections";

describe("launcher tile defaults", () => {
  it("uses branded default order", () => {
    expect(DEFAULT_LAUNCHER_TILE_ORDER).toEqual([
      "inventory",
      "debts",
      "cash",
      "cashPosition",
      "commandCenter",
      "investigation",
      "salesHistory",
      "shop",
      "reports",
      "profit",
      "settings",
    ]);
  });

  it("merges saved layout over defaults", () => {
    const merged = mergeLauncherTileLayout({ cash: { color: "red" } });
    expect(merged.cash?.color).toBe("red");
    expect(merged.inventory?.customColor).toBe(DEFAULT_LAUNCHER_TILE_LAYOUT.inventory?.customColor);
  });

  it("applies default colors when saved layout is empty", () => {
    const { secondary } = resolveHomeMenuTiles({
      savedOrder: [],
      layout: {},
      hasPermission: () => true,
    });
    const reports = secondary.find((t) => t.id === "reports");
    expect(reports?.customColor).toBe("#0d9488");
    expect(reports?.scale).toBe(50);
    expect(secondary.find((t) => t.id === "inventory")?.customColor).toBe("#db2777");
  });
});

describe("office hub tile defaults", () => {
  it("merges office hub defaults", () => {
    const merged = mergeOfficeHubTileLayout({});
    expect(merged.daily?.color).toBe("blue");
    expect(merged["shop-control"]?.customColor).toBe("#6b7280");
    expect(merged.data?.customColor).toBe("#0f766e");
  });

  it("resolves sections with default colors", () => {
    const sections = resolveOfficeHubSections({
      savedOrder: [],
      layout: {},
      sectionVisible: {
        daily: true,
        insights: true,
        "shop-control": true,
        data: true,
        help: true,
      },
    });
    expect(sections.find((s) => s.id === "daily")?.color).toBe("blue");
    expect(sections.find((s) => s.id === "insights")?.color).toBe("green");
    expect(sections.find((s) => s.id === "data")?.customColor).toBe(
      DEFAULT_OFFICE_HUB_TILE_LAYOUT.data?.customColor,
    );
  });
});
