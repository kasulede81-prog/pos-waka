import { describe, expect, it } from "vitest";
import {
  isMobileShortShelf,
  MOBILE_SHORT_SHELF_MAX_PRODUCTS,
  MOBILE_SHORT_SHELF_POPULAR_MAX,
  shouldShowMobileShelfEndCue,
} from "./posMobileShortShelf";

describe("posMobileShortShelf (M1.3 / M1.4 / M1.4-R2)", () => {
  it("treats 1–3 product shelves as short (secondary rails)", () => {
    expect(isMobileShortShelf(1)).toBe(true);
    expect(isMobileShortShelf(3)).toBe(true);
    expect(MOBILE_SHORT_SHELF_MAX_PRODUCTS).toBe(3);
  });

  it("does not treat empty or larger shelves as short", () => {
    expect(isMobileShortShelf(0)).toBe(false);
    expect(isMobileShortShelf(4)).toBe(false);
    expect(isMobileShortShelf(50)).toBe(false);
  });

  it("shows a compact end cue only for 4–6 products", () => {
    expect(shouldShowMobileShelfEndCue(3)).toBe(false);
    expect(shouldShowMobileShelfEndCue(4)).toBe(true);
    expect(shouldShowMobileShelfEndCue(6)).toBe(true);
    expect(shouldShowMobileShelfEndCue(7)).toBe(false);
  });

  it("keeps Popular rail item cap small", () => {
    expect(MOBILE_SHORT_SHELF_POPULAR_MAX).toBeLessThanOrEqual(6);
  });
});
