import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cashierDensityInputAutoZoomRisks,
  displayScaleInputFontPx,
  IOS_FORM_CONTROL_AUTOZOOM_MIN_PX,
  viewportMetaAllowsAccessibilityZoom,
} from "./iosFormControlZoom";
import { POS_CATALOG_TILE_TOUCH_CLASS, POS_ARRANGE_TOUCH_CLASS } from "./posTouchInteraction";
import { POS_MOBILE_CHECKOUT_WORKSPACE_HEIGHT } from "./posMobileCheckoutBudget";

const root = process.cwd();

function readRepo(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("MOBILE-UX-1.0 iOS viewport stability", () => {
  it("Display Scale input token is below Safari's auto-zoom threshold", () => {
    expect(displayScaleInputFontPx("normal")).toBeCloseTo(14, 3);
    expect(displayScaleInputFontPx("compact")).toBeLessThan(14);
    expect(displayScaleInputFontPx("large")).toBeLessThan(IOS_FORM_CONTROL_AUTOZOOM_MIN_PX);
    const risks = cashierDensityInputAutoZoomRisks();
    expect(risks.compact).toBe(true);
    expect(risks.normal).toBe(true);
    expect(risks.large).toBe(true);
  });

  it("viewport meta keeps device-width and accessibility zoom", () => {
    const html = readRepo("index.html");
    const match = html.match(/<meta name="viewport" content="([^"]+)"/);
    expect(match?.[1]).toBeTruthy();
    expect(viewportMetaAllowsAccessibilityZoom(match![1])).toBe(true);
    expect(html).not.toMatch(/user-scalable\s*=\s*no/i);
    expect(html).not.toMatch(/maximum-scale\s*=\s*1(\.0)?/i);
  });

  it("iOS form controls get a 16px floor without CSS zoom or root scale", () => {
    const css = readRepo("src/index.css");
    expect(css).toContain("-webkit-touch-callout: none");
    expect(css).toContain("font-size: max(16px, 1em)");
    expect(css).toContain("font-size: max(16px, var(--ds-font-base))");
    expect(css).not.toMatch(/^\s*zoom\s*:/m);
    expect(css).not.toMatch(/html\s*\{[^}]*transform:\s*scale/s);
    expect(css).not.toMatch(/#root\s*\{[^}]*transform:\s*scale/s);
  });

  it("does not globally disable pinch zoom", () => {
    const css = readRepo("src/index.css");
    expect(css).not.toMatch(/user-scalable\s*:\s*none/i);
    expect(readRepo("capacitor.config.ts")).not.toMatch(/maximumScale|userScalable/);
  });

  it("keeps Android catalog tiles on touch-pan-y (Phase 25.2)", () => {
    expect(POS_CATALOG_TILE_TOUCH_CLASS).toBe("touch-pan-y");
    expect(POS_ARRANGE_TOUCH_CLASS).toBe("touch-manipulation");
  });

  it("does not change full-screen checkout workspace height", () => {
    expect(POS_MOBILE_CHECKOUT_WORKSPACE_HEIGHT).toBe("100dvh");
  });
});
