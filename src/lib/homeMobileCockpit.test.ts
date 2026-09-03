import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeMobileWorkspace, HOME_MOBILE_WORKSPACE_IDS } from "./homeMobileComposition";
import { HOME_REGION_ORDER_LARGE } from "./homePresentation";
import type { ResolvedHomeTile } from "./launcherTiles";
import type { LucideIcon } from "lucide-react";

function readSrc(relativeFromLib: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), relativeFromLib), "utf8");
}

function tile(id: string): ResolvedHomeTile {
  return {
    id,
    labelKey: "desktopHomeTileInventory",
    to: `/${id}`,
    Icon: (() => null) as unknown as LucideIcon,
    group: "management",
    hideable: true,
    color: "orange",
    customColor: null,
    scale: 35,
    pinned: false,
    hidden: false,
  };
}

describe("HOME V8.1 mobile cockpit", () => {
  it("orders the mobile 2×2 workspace without inventing tiles", () => {
    expect(HOME_MOBILE_WORKSPACE_IDS).toEqual(["inventory", "cash", "cashPosition", "reports"]);
    const ordered = composeMobileWorkspace([tile("cashPosition"), tile("inventory"), tile("cash")], tile("reports"));
    expect(ordered.map((item) => item.id)).toEqual(["inventory", "cash", "cashPosition", "reports"]);
  });

  it("does not change the desktop region order or desktop pulse console", () => {
    expect(HOME_REGION_ORDER_LARGE).toEqual(["hero", "primary", "reports", "operations", "admin"]);
    const pulse = readSrc("../components/home/LivingBusinessPulse.tsx");
    expect(pulse).toContain("home-living-pulse--console");
    expect(pulse).toContain("onClick={onSell}");
    expect(pulse).not.toContain("MobileHomeCockpit");

    const tiles = readSrc("../components/home/DesktopHomeTiles.tsx");
    expect(tiles).toContain("mobileCockpit");
    expect(tiles).toContain("MobileHomeCockpit");
    expect(tiles).toContain("HomeLiveBusinessFloor");
    expect(tiles).toContain("renderLiveFloor");
    expect(tiles).not.toContain("Math.random");
    expect(tiles).not.toContain("setInterval");
    expect(tiles).not.toContain("pulseDrawer");
  });

  it("uses a dedicated mobile presentation with no new animation libraries", () => {
    const cockpit = readSrc("../components/home/MobileHomeCockpit.tsx");
    expect(cockpit).toContain("home-mobile-new-sale");
    expect(cockpit).toContain("HomeAskWakaShortcut");
    expect(cockpit).toContain("onClick={onSell}");
    expect(cockpit).toContain("enterpriseMotion.press");
    expect(cockpit).not.toContain("from \"three\"");
    expect(cockpit).not.toContain("@rive-app");
    expect(cockpit).not.toContain("from \"lottie-react\"");
    expect(cockpit).not.toContain("setTimeout");

    const css = readSrc("../index.css");
    expect(css).toContain(".home-mobile-cockpit");
    expect(css).toContain("html[data-home-anim-paused] .home-mobile-new-sale__glow");
    expect(css).toContain("repeat(12, minmax(0, 1fr))");
    expect(css).not.toContain("minmax(11.25rem, 0.34fr)");
  });
});
