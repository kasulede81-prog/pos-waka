import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOME_COMPOSITION_SPAN, HOME_TYPE_SCALE } from "./homeComposition";
import { HOME_REGION_ORDER_LARGE } from "./homePresentation";

function readSrc(relativeFromLib: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), relativeFromLib), "utf8");
}

describe("HOME V8 console remix", () => {
  it("keeps the V3.1 region order and treats the shop scene as atmosphere", () => {
    expect(HOME_REGION_ORDER_LARGE).toEqual(["hero", "primary", "reports", "operations", "admin"]);
    expect(HOME_COMPOSITION_SPAN.heroShop).toBe(0);
    expect(HOME_COMPOSITION_SPAN.heroLead + HOME_COMPOSITION_SPAN.heroSupport).toBe(12);
    expect(HOME_COMPOSITION_SPAN.primary + HOME_COMPOSITION_SPAN.live).toBe(12);
    expect(HOME_COMPOSITION_SPAN.cta).toBe(12);

    const pulse = readSrc("../components/home/LivingBusinessPulse.tsx");
    expect(pulse).toContain("home-living-pulse--console");
    expect(pulse).toContain("home-living-pulse__atmosphere");
    expect(pulse).toContain("home-new-sale-cta");
    expect(pulse).toContain("HomeAskWakaShortcut");
    expect(pulse).toContain("onClick={onSell}");
    expect(pulse).toContain("enterpriseMotion.press");
    expect(pulse).not.toContain("setTimeout");
    expect(pulse).not.toContain("from \"three\"");
    expect(pulse).not.toContain("@rive-app");
    expect(pulse).not.toContain("from \"lottie-react\"");
  });

  it("does not add animation libraries or fake live data", () => {
    const tiles = readSrc("../components/home/DesktopHomeTiles.tsx");
    expect(tiles).toContain("useHomeDashboardMetrics");
    expect(tiles).not.toContain("Math.random");
    expect(tiles).not.toContain("setInterval");
    expect(tiles).not.toContain("fakeSale");
    expect(tiles).not.toContain("pulseDrawer");

    const css = readSrc("../index.css");
    expect(css).toContain("home-new-sale-glow");
    expect(css).toContain("html[data-home-anim-paused] .home-new-sale-cta__glow");
    expect(css).not.toContain("minmax(11.25rem, 0.34fr)");
    expect(HOME_TYPE_SCALE.metric).toContain("text-5xl");
  });
});
