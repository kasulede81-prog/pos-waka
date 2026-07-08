import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAUNCHER_TILE_LAYOUT,
  DEFAULT_LAUNCHER_TILE_ORDER,
  mergeLauncherTileLayout,
  PHARMACY_LAUNCHER_TILE_ORDER,
  resolveHomeMenuTiles,
} from "./launcherTiles";
import { DEFAULT_OFFICE_HUB_TILE_LAYOUT, mergeOfficeHubTileLayout, resolveOfficeHubSections } from "./officeHubSections";
import { PHARMACY_DISPENSE_ROUTE, PHARMACY_HOME_ROUTE } from "./pharmacyNav";

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

  it("prepends dashboard for pharmacy order", () => {
    expect(PHARMACY_LAUNCHER_TILE_ORDER[0]).toBe("dashboard");
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

  it("adds pharmacy dashboard tile and dispense hero route", () => {
    const { hero, secondary } = resolveHomeMenuTiles({
      savedOrder: [],
      layout: {},
      hasPermission: () => true,
      pharmacyMode: true,
    });
    expect(hero?.labelKey).toBe("desktopHomeTileDispense");
    expect(hero?.to).toBe(PHARMACY_DISPENSE_ROUTE);
    expect(secondary.find((t) => t.id === "dashboard")?.to).toBe(PHARMACY_HOME_ROUTE);
    expect(secondary.find((t) => t.id === "inventory")?.to).toBe("/pharmacy/inventory");
    expect(secondary.find((t) => t.id === "reports")?.to).toBe("/pharmacy/reports");
    expect(secondary.find((t) => t.id === "salesHistory")?.labelKey).toBe("pharmacyDispensingHistory");
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
