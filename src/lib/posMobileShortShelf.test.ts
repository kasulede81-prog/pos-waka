import { describe, expect, it } from "vitest";
import { isMobileShortShelf, MOBILE_SHORT_SHELF_MAX_PRODUCTS } from "./posMobileShortShelf";

describe("isMobileShortShelf (M1.3)", () => {
  it("treats 1–3 product shelves as short", () => {
    expect(isMobileShortShelf(1)).toBe(true);
    expect(isMobileShortShelf(3)).toBe(true);
    expect(MOBILE_SHORT_SHELF_MAX_PRODUCTS).toBe(3);
  });

  it("does not treat empty or larger shelves as short", () => {
    expect(isMobileShortShelf(0)).toBe(false);
    expect(isMobileShortShelf(4)).toBe(false);
    expect(isMobileShortShelf(50)).toBe(false);
  });
});
