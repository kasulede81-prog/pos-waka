import { describe, expect, it } from "vitest";
import {
  checkoutPanelsAreExclusive,
  shouldMountDesktopCheckoutSidebar,
  shouldMountMobileCheckoutOverlay,
} from "./posCheckoutMount";

describe("posCheckoutMount", () => {
  it("mounts desktop sidebar only on desktop with products", () => {
    expect(shouldMountDesktopCheckoutSidebar(true, true)).toBe(true);
    expect(shouldMountDesktopCheckoutSidebar(false, true)).toBe(false);
    expect(shouldMountDesktopCheckoutSidebar(true, false)).toBe(false);
  });

  it("mounts mobile overlay only on mobile with open checkout", () => {
    expect(shouldMountMobileCheckoutOverlay(false, 2, false)).toBe(true);
    expect(shouldMountMobileCheckoutOverlay(true, 2, false)).toBe(false);
    expect(shouldMountMobileCheckoutOverlay(false, 0, false)).toBe(false);
    expect(shouldMountMobileCheckoutOverlay(false, 2, true)).toBe(false);
  });

  it("never mounts desktop sidebar and mobile overlay together", () => {
    expect(
      checkoutPanelsAreExclusive(
        shouldMountDesktopCheckoutSidebar(true, true),
        shouldMountMobileCheckoutOverlay(true, 1, false),
      ),
    ).toBe(true);
    expect(checkoutPanelsAreExclusive(true, true)).toBe(false);
  });
});
