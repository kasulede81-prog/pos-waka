import { describe, expect, it } from "vitest";
import { getBackFallbackPath } from "./navigationBack";

describe("getBackFallbackPath", () => {
  it("returns main menu for settings hub on desktop and mobile", () => {
    expect(getBackFallbackPath("/settings", { desktopTerminal: true })).toBe("/");
    expect(getBackFallbackPath("/settings")).toBe("/");
  });

  it("returns settings hub for settings subpages and staff access", () => {
    expect(getBackFallbackPath("/settings/shop", { desktopTerminal: true })).toBe("/settings");
    expect(getBackFallbackPath("/staff-access")).toBe("/settings");
    expect(getBackFallbackPath("/office/hardware")).toBe("/settings");
  });
});

/** Mirrors minimize-at-root logic in useAndroidBackButton. */
function shouldMinimizeApp(pathname: string, fallback: string): boolean {
  const ROOT = new Set(["/", "/pos"]);
  if (ROOT.has(pathname)) return true;
  return fallback === pathname;
}

describe("android back root minimize", () => {
  it("minimizes at home and sell routes", () => {
    expect(shouldMinimizeApp("/", "/")).toBe(true);
    expect(shouldMinimizeApp("/pos", "/")).toBe(true);
  });

  it("navigates from office child when no history", () => {
    expect(shouldMinimizeApp("/office/purchases", "/office")).toBe(false);
  });

  it("minimizes when fallback equals current path", () => {
    expect(shouldMinimizeApp("/settings", "/settings")).toBe(true);
  });
});
