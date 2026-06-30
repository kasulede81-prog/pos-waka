import { describe, expect, it } from "vitest";
import {
  checkoutPanelsAreExclusive,
  shouldMountCompactCheckoutSlideover,
  shouldMountDesktopCheckoutSidebar,
  shouldMountMobileCheckoutOverlay,
  shouldShowMinimizedCheckoutFab,
} from "./posCheckoutMount";

describe("posCheckoutMount", () => {
  it("mounts desktop sidebar only on full desktop with an active sale", () => {
    expect(shouldMountDesktopCheckoutSidebar("full", true, 2, false)).toBe(true);
    expect(shouldMountDesktopCheckoutSidebar("full", true, 0, false)).toBe(false);
    expect(shouldMountDesktopCheckoutSidebar("full", true, 2, true)).toBe(false);
    expect(shouldMountDesktopCheckoutSidebar("compact", true, 2, false)).toBe(false);
    expect(shouldMountDesktopCheckoutSidebar("mobile", true, 2, false)).toBe(false);
    expect(shouldMountDesktopCheckoutSidebar("full", false, 2, false)).toBe(false);
  });

  it("mounts compact slideover on compact desktop with open checkout", () => {
    expect(shouldMountCompactCheckoutSlideover("compact", 2, false)).toBe(true);
    expect(shouldMountCompactCheckoutSlideover("full", 2, false)).toBe(false);
    expect(shouldMountCompactCheckoutSlideover("compact", 0, false)).toBe(false);
    expect(shouldMountCompactCheckoutSlideover("compact", 2, true)).toBe(false);
  });

  it("mounts mobile overlay only on mobile with open checkout", () => {
    expect(shouldMountMobileCheckoutOverlay("mobile", 2, false)).toBe(true);
    expect(shouldMountMobileCheckoutOverlay("compact", 2, false)).toBe(false);
    expect(shouldMountMobileCheckoutOverlay("mobile", 0, false)).toBe(false);
    expect(shouldMountMobileCheckoutOverlay("mobile", 2, true)).toBe(false);
  });

  it("shows minimized fab when checkout is minimized with items", () => {
    expect(shouldShowMinimizedCheckoutFab("mobile", 2, true)).toBe(true);
    expect(shouldShowMinimizedCheckoutFab("compact", 2, true)).toBe(true);
    expect(shouldShowMinimizedCheckoutFab("full", 2, true)).toBe(true);
    expect(shouldShowMinimizedCheckoutFab("full", 2, false)).toBe(false);
    expect(shouldShowMinimizedCheckoutFab("compact", 0, true)).toBe(false);
  });

  it("never mounts more than one checkout panel", () => {
    expect(checkoutPanelsAreExclusive(true, false, false)).toBe(true);
    expect(checkoutPanelsAreExclusive(false, true, false)).toBe(true);
    expect(checkoutPanelsAreExclusive(false, false, true)).toBe(true);
    expect(checkoutPanelsAreExclusive(true, true, false)).toBe(false);
  });
});
