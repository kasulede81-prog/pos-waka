import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOME_LIVING_AMBIENT_S,
  homeDrawerKickSignature,
  homeDrawerPresentationState,
} from "./homeLivingMotion";

describe("homeLivingMotion", () => {
  it("keeps ambient cycles in the 12–30s comfort band", () => {
    expect(HOME_LIVING_AMBIENT_S.shell).toBeGreaterThanOrEqual(12);
    expect(HOME_LIVING_AMBIENT_S.drift).toBeLessThanOrEqual(30);
    expect(HOME_LIVING_AMBIENT_S.drawerIdle).toBeGreaterThanOrEqual(12);
  });

  it("maps real drawer audit to presentation without inventing a kick", () => {
    expect(homeDrawerPresentationState(null, false)).toBe("idle");
    expect(homeDrawerPresentationState({ id: "a", ok: true, reason: "manual" }, true)).toBe("idle");
    expect(homeDrawerPresentationState({ id: "a", ok: true, reason: "payment" }, false)).toBe("open");
    expect(homeDrawerPresentationState({ id: "a", ok: false, reason: "manual" }, false)).toBe("failed");
    expect(homeDrawerKickSignature({ id: "k1", at: "2026-09-02T10:00:00.000Z", ok: true })).toBe(
      "k1:2026-09-02T10:00:00.000Z:1",
    );
  });

  it("Home cash drawer scene is local SVG and never pulses hardware", () => {
    const scene = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../components/home/HomeCashDrawerScene.tsx"),
      "utf8",
    );
    expect(scene).toContain("<svg");
    expect(scene).toContain("home-drawer-tray");
    expect(scene).not.toContain("pulseDrawer");
    expect(scene).not.toContain("kickCashDrawer");
    expect(scene).not.toContain("setInterval");
    expect(scene).not.toContain("Math.random");
    expect(scene).not.toContain("@rive-app");
    expect(scene).not.toContain("from \"three\"");
  });

  it("kick hook only reads drawerAudit and never sends ESC/POS", () => {
    const hook = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../hooks/useHomeCashDrawerKick.ts"),
      "utf8",
    );
    expect(hook).toContain("drawerAudit");
    expect(hook).not.toContain("pulseDrawer");
    expect(hook).not.toContain("openCashDrawerManual");
    expect(hook).not.toContain("setInterval");
    expect(hook).not.toContain("Math.random");
  });
});
