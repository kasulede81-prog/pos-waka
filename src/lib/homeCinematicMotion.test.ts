import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOME_CONTENT_MAX_WIDTH_PX, HOME_CONTENT_MEASURE_CLASS, HOME_REGION_ORDER_LARGE } from "./homePresentation";

function readSrc(relativeFromLib: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), relativeFromLib), "utf8");
}

describe("HOME CINEMATIC V4", () => {
  it("uses the full desktop canvas up to a 2560px cap", () => {
    expect(HOME_CONTENT_MAX_WIDTH_PX).toBe(2560);
    expect(HOME_CONTENT_MEASURE_CLASS).toContain("max-w-[160rem]");
    expect(HOME_REGION_ORDER_LARGE).toEqual(["hero", "primary", "reports", "operations", "admin"]);
  });

  it("reuses existing parallax, spotlight, pause, and tile art — no new motion library", () => {
    const card = readSrc("../components/home/LivingDashboardCard.tsx");
    expect(card).toContain("useHomeTileParallax");
    expect(card).toContain("HomeTileArt");
    expect(card).not.toContain("three");
    expect(card).not.toContain("from \"framer-motion\"");
    expect(card).not.toContain("@rive-app");

    const tiles = readSrc("../components/home/DesktopHomeTiles.tsx");
    expect(tiles).toContain("useHomeTileSpotlight");
    expect(tiles).toContain("useHomeDashboardAnimationPause");
    expect(tiles).toContain("pointerMotion={!animPaused}");
  });

  it("NEW SALE stays a direct click — no animation wait before navigate", () => {
    const pulse = readSrc("../components/home/LivingBusinessPulse.tsx");
    expect(pulse).toContain("onClick={onSell}");
    expect(pulse).not.toContain("setTimeout");
    expect(pulse).not.toContain("await");
    expect(pulse).toContain("enterpriseMotion.press");
    expect(pulse).not.toContain("from \"three\"");
    expect(pulse).not.toContain("@react-three");
  });

  it("ambient motion is compositor-friendly and reduced-motion safe", () => {
    const css = readSrc("../index.css");
    expect(css).toContain("home-shell-breathe");
    expect(css).toContain("home-pulse-ambient");
    expect(css).toContain("will-change: transform, opacity");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("html[data-home-anim-paused] .home-cinematic-shell::before");
    expect(css).not.toContain("three.js");
  });

  it("sizes the Home stage to content instead of a clipped full-viewport grid", () => {
    const css = readSrc("../index.css");
    expect(css).toContain("home-stage");
    expect(css).toContain("home-cinematic-shell--stage");
    expect(css).not.toContain("minmax(11.25rem, 0.34fr)");
    expect(css).not.toContain("grid-auto-flow: column");

    const tiles = readSrc("../components/home/DesktopHomeTiles.tsx");
    expect(tiles).not.toContain("home-stage h-full");
    expect(tiles).not.toContain("home-ops-band");

    const pulse = readSrc("../components/home/LivingBusinessPulse.tsx");
    expect(pulse).not.toContain("home-living-pulse--command h-full");
  });

  it("keeps Reports title and subtitle as stacked block text", () => {
    const reports = readSrc("../components/home/HomeReportsPreview.tsx");
    expect(reports).toContain("flex min-w-0 flex-1 flex-col gap-0.5");
    expect(reports).toContain('SectionTitle as="span"');
    expect(reports).toContain('Caption as="span"');
    expect(reports).toContain("block min-w-0 !text-base");
    expect(reports).toContain("mt-0 block min-w-0 normal-case");
  });

  it("hides the stability overlay on Home without disabling DEV diagnostics elsewhere", () => {
    const app = readSrc("../App.tsx");
    expect(app).toContain("StabilityDiagnosticsOverlay");
    expect(app).toContain("StabilityDiagnosticsHost");
    expect(app).toContain('pathname === "/"');
    expect(app).toContain("isDiagnosticsEnabled");
  });

  it("adds a local SVG cash drawer and ambient wash without new runtime libraries", () => {
    const card = readSrc("../components/home/LivingDashboardCard.tsx");
    expect(card).toContain("HomeCashDrawerScene");
    expect(card).toContain("drawerKick");
    expect(card).not.toContain("from \"lottie-react\"");

    const page = readSrc("../pages/DesktopHomePage.tsx");
    expect(page).toContain("home-cinematic-shell__wash");
    expect(page).toContain("home-cinematic-shell--living");

    const tiles = readSrc("../components/home/DesktopHomeTiles.tsx");
    expect(tiles).toContain("useHomeCashDrawerKick");
    expect(tiles).not.toContain("pulseDrawer");
    expect(tiles).not.toContain("openCashDrawerManual");

    const css = readSrc("../index.css");
    expect(css).toContain("home-drawer-open");
    expect(css).toContain("home-shell-wash");
    expect(css).toContain("home-sale-flash");
  });

  it("does not invent fake business events on Home", () => {
    const tiles = readSrc("../components/home/DesktopHomeTiles.tsx");
    expect(tiles).toContain("useHomeDashboardMetrics");
    expect(tiles).toContain("weekTrend");
    expect(tiles).not.toContain("fakeSale");
    expect(tiles).not.toContain("mockActivity");
    expect(tiles).not.toContain("setInterval");

    const metrics = readSrc("../hooks/useHomeDashboardMetrics.ts");
    expect(metrics).toContain("localGetRollingSevenDaySalesSummary");
    expect(metrics).not.toContain("setInterval");
    expect(metrics).not.toContain("Math.random");
  });
});
