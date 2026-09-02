import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOME_REGION_ORDER_LARGE } from "./homePresentation";

function readSrc(relativeFromLib: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), relativeFromLib), "utf8");
}

describe("HOME REMIX V6", () => {
  it("keeps the V3.1 region order and does not reintroduce a clipped stage", () => {
    expect(HOME_REGION_ORDER_LARGE).toEqual(["hero", "primary", "reports", "operations", "admin"]);
    const css = readSrc("../index.css");
    expect(css).not.toContain("minmax(11.25rem, 0.34fr)");
    expect(css).toContain("home-module-card--world");
    expect(css).toContain("home-live-floor");
  });

  it("turns tiles into local SVG scenes on colored surfaces — no new runtime libraries", () => {
    const card = readSrc("../components/home/LivingDashboardCard.tsx");
    expect(card).toContain("HomeTileScene");
    expect(card).toContain("HomeTileArt");
    expect(card).toContain("HomeCashDrawerScene");
    expect(card).toContain("data-home-world");
    expect(card).toContain("resolveHomeWorldSurface");
    expect(card).not.toContain("from \"three\"");
    expect(card).not.toContain("@rive-app");
    expect(card).not.toContain("from \"lottie-react\"");
    expect(card).not.toContain("from \"framer-motion\"");
    expect(card).not.toContain("Math.random");
    expect(card).not.toContain("setInterval");
  });

  it("wires the unused Live Business Floor between Primary work and Operations", () => {
    const tiles = readSrc("../components/home/DesktopHomeTiles.tsx");
    expect(tiles).toContain("HomeLiveBusinessFloor");
    expect(tiles).toContain("renderLiveFloor");
    expect(tiles).toContain("useHomeDashboardMetrics");
    expect(tiles).not.toContain("fakeSale");
    expect(tiles).not.toContain("mockActivity");
    expect(tiles).not.toContain("setInterval");

    const regions = readSrc("../components/home/HomeOrderedRegions.tsx");
    expect(regions).toContain("live-floor");
    expect(regions).toContain("renderLiveFloor");
  });

  it("cash drawer scene stays local SVG and never pulses hardware", () => {
    const drawer = readSrc("../components/home/HomeCashDrawerScene.tsx");
    expect(drawer).toContain("<svg");
    expect(drawer).toContain("home-drawer-tray");
    expect(drawer).not.toContain("pulseDrawer");
    expect(drawer).not.toContain("Math.random");
    expect(drawer).not.toContain("from \"three\"");
  });
});
