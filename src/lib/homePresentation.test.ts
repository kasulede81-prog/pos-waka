import { describe, expect, it } from "vitest";
import {
  applyHomeBandOrder,
  homeContentInnerWidthPx,
  homePresentationStructure,
  HOME_MODULE_GRID_CLASS,
  presentHomeMenuTiles,
  resolveHomeFirstScreenOrder,
  resolveHomePresentation,
  resolveHomeRegionLayout,
  resolveHomeRegionOrder,
  resolveHomeSettingsRegionOrder,
  visibleHomePresentationStructure,
  visibleHomeRegionOrder,
} from "./homePresentation";
import { homeModuleBand } from "./homeModulePriority";
import type { LauncherTileConfig } from "../types";
import {
  normalizeLauncherTileLayout,
  resolveHomeMenuTiles,
  updateLauncherTileLayout,
} from "./launcherTiles";

const allowAll = () => true;

function resolveBoth(savedOrder: string[], layout: Record<string, LauncherTileConfig>) {
  const live = resolveHomePresentation({
    savedOrder,
    layout,
    hasPermission: allowAll,
    includeHidden: false,
  });
  const settings = resolveHomePresentation({
    savedOrder,
    layout,
    hasPermission: allowAll,
    includeHidden: true,
  });
  return { live, settings };
}

describe("resolveHomePresentation", () => {
  it("locks Sell as hero and never places it in a band", () => {
    const presentation = resolveHomePresentation({
      savedOrder: ["inventory", "debts", "settings"],
      layout: {},
      hasPermission: allowAll,
    });
    const structure = homePresentationStructure(presentation);
    expect(structure.heroId).toBe("sell");
    expect(structure.heroLocked).toBe(true);
    expect(structure.primaryIds).not.toContain("sell");
    expect(structure.secondaryIds).not.toContain("sell");
    expect(structure.adminIds).not.toContain("sell");
  });

  it("keeps Reports on the dedicated HomeReportsPreview renderer, not a band card", () => {
    const presentation = resolveHomePresentation({
      savedOrder: ["reports", "inventory", "cash"],
      layout: {},
      hasPermission: allowAll,
    });
    const structure = homePresentationStructure(presentation);
    expect(structure.reportsId).toBe("reports");
    expect(structure.reportsRenderer).toBe("HomeReportsPreview");
    expect(structure.primaryIds).not.toContain("reports");
    expect(structure.secondaryIds).not.toContain("reports");
    expect(structure.adminIds).not.toContain("reports");
    expect(homeModuleBand("reports")).toBe("primary");
  });

  it("preserves Primary order A, B, C", () => {
    const presentation = resolveHomePresentation({
      savedOrder: ["inventory", "cash", "cashPosition"],
      layout: {},
      hasPermission: allowAll,
    });
    expect(presentation.primary.map((t) => t.id)).toEqual(["inventory", "cash", "cashPosition"]);
  });

  it("preserves Secondary order D, E, F", () => {
    const presentation = resolveHomePresentation({
      savedOrder: ["debts", "salesHistory", "shop"],
      layout: {},
      hasPermission: allowAll,
    });
    expect(presentation.secondary.map((t) => t.id).slice(0, 3)).toEqual([
      "debts",
      "salesHistory",
      "shop",
    ]);
  });

  it("preserves Admin order G, H", () => {
    const presentation = resolveHomePresentation({
      savedOrder: ["settings", "investigation"],
      layout: {},
      hasPermission: allowAll,
    });
    expect(presentation.admin.map((t) => t.id).slice(0, 2)).toEqual(["settings", "investigation"]);
  });

  it("does not represent cross-band movement as possible", () => {
    const presentation = resolveHomePresentation({
      savedOrder: ["settings", "inventory", "debts", "cash"],
      layout: {},
      hasPermission: allowAll,
    });
    const structure = homePresentationStructure(presentation);
    expect(structure.primaryIds[0]).toBe("inventory");
    expect(structure.primaryIds).toContain("cash");
    expect(structure.secondaryIds[0]).toBe("debts");
    expect(structure.adminIds[0]).toBe("settings");
    expect(structure.primaryIds).not.toContain("settings");
    expect(structure.primaryIds).not.toContain("debts");
    expect(structure.secondaryIds).not.toContain("inventory");
    expect(structure.adminIds).not.toContain("inventory");
  });
});

describe("Home hidden state", () => {
  it("hides a tile on live and keeps it marked hidden in Settings", () => {
    const layout = { profit: { hidden: true } };
    const { live, settings } = resolveBoth(["debts", "profit", "shop"], layout);
    expect(live.secondary.map((t) => t.id)).not.toContain("profit");
    const arrangeProfit = settings.secondary.find((t) => t.id === "profit");
    expect(arrangeProfit?.hidden).toBe(true);
  });

  it("unhides a tile on live after hidden is cleared", () => {
    const hidden = updateLauncherTileLayout({}, "profit", { hidden: true });
    const shown = updateLauncherTileLayout(hidden, "profit", { hidden: false });
    const liveHidden = resolveHomePresentation({
      savedOrder: ["profit", "debts"],
      layout: hidden,
      hasPermission: allowAll,
    });
    const liveShown = resolveHomePresentation({
      savedOrder: ["profit", "debts"],
      layout: shown,
      hasPermission: allowAll,
    });
    expect(liveHidden.secondary.map((t) => t.id)).not.toContain("profit");
    expect(liveShown.secondary.map((t) => t.id)).toContain("profit");
    expect(liveShown.secondary.find((t) => t.id === "profit")?.hidden).toBe(false);
  });

  it("persists hidden together with unused color/customColor/scale (no migration)", () => {
    const persisted = normalizeLauncherTileLayout({
      profit: { hidden: true, color: "purple", customColor: "#7c3aed", scale: 88 },
    });
    expect(persisted.profit).toEqual({
      hidden: true,
      color: "purple",
      customColor: "#7c3aed",
      scale: 88,
    });
    const live = resolveHomeMenuTiles({
      savedOrder: ["profit"],
      layout: persisted,
      hasPermission: allowAll,
    });
    expect(live.secondary.find((t) => t.id === "profit")).toBeUndefined();
    const arrange = resolveHomeMenuTiles({
      savedOrder: ["profit"],
      layout: persisted,
      hasPermission: allowAll,
      includeHidden: true,
    });
    const tile = arrange.secondary.find((t) => t.id === "profit");
    expect(tile?.hidden).toBe(true);
    expect(tile?.color).toBe("purple");
    expect(tile?.customColor).toBe("#7c3aed");
    expect(tile?.scale).toBe(88);
  });
});

describe("Settings preview vs live Home structure", () => {
  it("uses the same structural configuration for visible tiles", () => {
    const savedOrder = [
      "inventory",
      "cash",
      "cashPosition",
      "debts",
      "shop",
      "settings",
      "investigation",
      "reports",
    ];
    const layout = {
      investigation: { hidden: true },
      reports: { color: "purple" as const, customColor: "#7c3aed", scale: 90 },
    };
    const { live, settings } = resolveBoth(savedOrder, layout);

    expect(visibleHomePresentationStructure(live)).toEqual(visibleHomePresentationStructure(settings));
    expect(homePresentationStructure(live)).toMatchObject({
      heroId: "sell",
      reportsId: "reports",
      reportsRenderer: "HomeReportsPreview",
      heroLocked: true,
    });
    expect(live.primary.map((t) => t.id).slice(0, 3)).toEqual(["inventory", "cash", "cashPosition"]);
    expect(live.secondary.map((t) => t.id).slice(0, 2)).toEqual(["debts", "shop"]);
    expect(live.admin.map((t) => t.id)[0]).toBe("settings");
    expect(settings.admin.map((t) => t.id)).toContain("investigation");
    expect(settings.admin.find((t) => t.id === "investigation")?.hidden).toBe(true);
    expect(live.admin.map((t) => t.id)).not.toContain("investigation");
  });

  it("presentHomeMenuTiles matches resolveHomePresentation", () => {
    const resolved = resolveHomeMenuTiles({
      savedOrder: ["cash", "inventory", "profit"],
      layout: {},
      hasPermission: allowAll,
    });
    expect(presentHomeMenuTiles(resolved)).toEqual(
      resolveHomePresentation({
        savedOrder: ["cash", "inventory", "profit"],
        layout: {},
        hasPermission: allowAll,
      }),
    );
  });
});

describe("applyHomeBandOrder", () => {
  it("reorders only the given band and leaves other ids in place", () => {
    const full = ["inventory", "debts", "cash", "settings", "shop"];
    expect(applyHomeBandOrder(full, ["cash", "inventory"])).toEqual([
      "cash",
      "debts",
      "inventory",
      "settings",
      "shop",
    ]);
  });
});

describe("HOME cinematic density V1 layout tokens", () => {
  it("keeps phone full-bleed while widening 1440/1920 under a 1600px measure", () => {
    expect(homeContentInnerWidthPx(390)).toBe(390 - 32);
    expect(homeContentInnerWidthPx(768)).toBe(768 - 48);
    expect(homeContentInnerWidthPx(1024)).toBe(1024 - 64);
    expect(homeContentInnerWidthPx(1280)).toBe(1280 - 80);
    expect(homeContentInnerWidthPx(1440)).toBe(1440 - 80);
    expect(homeContentInnerWidthPx(1920)).toBe(1600 - 80);
  });

  it("does not stretch module-grid rows to the tallest sibling", () => {
    expect(HOME_MODULE_GRID_CLASS.comfortable).toContain("items-start");
    expect(HOME_MODULE_GRID_CLASS.comfortable).toContain("auto-rows-min");
    expect(HOME_MODULE_GRID_CLASS.compact).toContain("items-start");
    expect(HOME_MODULE_GRID_CLASS.compact).toContain("auto-rows-min");
  });

  it("preserves phone columns and adds 2xl density columns", () => {
    expect(HOME_MODULE_GRID_CLASS.comfortable).toContain("grid-cols-2");
    expect(HOME_MODULE_GRID_CLASS.comfortable).toContain("lg:grid-cols-3");
    expect(HOME_MODULE_GRID_CLASS.comfortable).toContain("xl:grid-cols-4");
    expect(HOME_MODULE_GRID_CLASS.comfortable).toContain("2xl:grid-cols-5");
    expect(HOME_MODULE_GRID_CLASS.compact).toContain("lg:grid-cols-4");
    expect(HOME_MODULE_GRID_CLASS.compact).toContain("xl:grid-cols-5");
    expect(HOME_MODULE_GRID_CLASS.compact).toContain("2xl:grid-cols-6");
  });
});

describe("HOME-DENSITY-1.2 region order", () => {
  const ownerFlags = {
    hasHero: true,
    hasKpis: true,
    hasHealth: true,
    hasPrimary: true,
    hasReports: true,
    hasOperations: true,
    hasAdmin: true,
  };

  it("A — small-screen owner order: greeting, sell, primary, reports, kpi, health, operations, admin", () => {
    expect(resolveHomeFirstScreenOrder(false)).toEqual([
      "greeting",
      "hero",
      "primary",
      "reports",
      "kpi",
      "health",
      "operations",
      "admin",
    ]);
  });

  it("B — large-screen owner order: greeting, sell, kpi, health, primary, reports, operations, admin", () => {
    expect(resolveHomeFirstScreenOrder(true)).toEqual([
      "greeting",
      "hero",
      "kpi",
      "health",
      "primary",
      "reports",
      "operations",
      "admin",
    ]);
  });

  it("C — Reports stays a dedicated HomeReportsPreview region, not a band tile", () => {
    const presentation = resolveHomePresentation({
      savedOrder: ["reports", "inventory"],
      layout: {},
      hasPermission: allowAll,
    });
    expect(homePresentationStructure(presentation).reportsRenderer).toBe("HomeReportsPreview");
    expect(resolveHomeRegionOrder(false).indexOf("reports")).toBeGreaterThan(
      resolveHomeRegionOrder(false).indexOf("primary"),
    );
    expect(presentation.primary.map((t) => t.id)).not.toContain("reports");
  });

  it("D — Sell remains locked hero and is not a band region", () => {
    const presentation = resolveHomePresentation({
      savedOrder: ["inventory"],
      layout: {},
      hasPermission: allowAll,
    });
    expect(homePresentationStructure(presentation).heroLocked).toBe(true);
    expect(resolveHomeRegionOrder(false)[0]).toBe("hero");
    expect(resolveHomeRegionOrder(true)[0]).toBe("hero");
    expect(presentation.primary.map((t) => t.id)).not.toContain("sell");
  });

  it("E — Settings preview uses the same order with KPI/Health stripped", () => {
    expect(resolveHomeSettingsRegionOrder(false)).toEqual([
      "hero",
      "primary",
      "reports",
      "operations",
      "admin",
    ]);
    expect(resolveHomeSettingsRegionOrder(true)).toEqual([
      "hero",
      "primary",
      "reports",
      "operations",
      "admin",
    ]);
    expect(visibleHomeRegionOrder({ ...ownerFlags, largeScreen: false, hasKpis: false, hasHealth: false })).toEqual(
      resolveHomeSettingsRegionOrder(false),
    );
    expect(visibleHomeRegionOrder({ ...ownerFlags, largeScreen: true, hasKpis: false, hasHealth: false })).toEqual(
      resolveHomeSettingsRegionOrder(true),
    );
  });

  it("F — hidden Reports leaves no reports region", () => {
    expect(visibleHomeRegionOrder({ ...ownerFlags, largeScreen: false, hasReports: false })).not.toContain(
      "reports",
    );
    expect(visibleHomeRegionOrder({ ...ownerFlags, largeScreen: true, hasReports: false })).not.toContain(
      "reports",
    );
  });

  it("G — absent KPI collapses with no placeholder", () => {
    const order = visibleHomeRegionOrder({ ...ownerFlags, largeScreen: true, hasKpis: false });
    expect(order).toEqual(["hero", "health", "primary", "reports", "operations", "admin"]);
    expect(order).not.toContain("kpi");
  });

  it("H — cashier-style thin Home: sell + inventory, no empty reports/admin slots", () => {
    const order = visibleHomeRegionOrder({
      largeScreen: false,
      hasHero: true,
      hasKpis: true,
      hasHealth: true,
      hasPrimary: true,
      hasReports: false,
      hasOperations: true,
      hasAdmin: false,
    });
    expect(order).toEqual(["hero", "primary", "kpi", "health", "operations"]);
    expect(order[0]).toBe("hero");
    expect(order[1]).toBe("primary");
  });

  it("I — within-band Primary order is unchanged by region reorder", () => {
    const presentation = resolveHomePresentation({
      savedOrder: ["inventory", "cash", "cashPosition"],
      layout: {},
      hasPermission: allowAll,
    });
    expect(presentation.primary.map((t) => t.id)).toEqual(["inventory", "cash", "cashPosition"]);
  });

  it("packs executive scan only between lg and xl (1024–1279)", () => {
    expect(resolveHomeRegionLayout(390).packExecutiveScan).toBe(false);
    expect(resolveHomeRegionLayout(768).packExecutiveScan).toBe(false);
    expect(resolveHomeRegionLayout(1024).packExecutiveScan).toBe(true);
    expect(resolveHomeRegionLayout(1279).packExecutiveScan).toBe(true);
    expect(resolveHomeRegionLayout(1280).packExecutiveScan).toBe(false);
    expect(resolveHomeRegionLayout(1440).packExecutiveScan).toBe(false);
  });
});
