import { describe, expect, it } from "vitest";
import {
  MOBILE_CHECKOUT_ITEMS_AUTO_SHOW_MAX,
  MOBILE_CHECKOUT_ITEMS_COLLAPSED_PREVIEW,
  resolveMobileCheckoutItemsVisibility,
} from "./posMobileCheckoutItems";

describe("resolveMobileCheckoutItemsVisibility (M1.1-R4)", () => {
  it("shows all lines without disclosure for 1–3 products", () => {
    for (const n of [1, 2, 3] as const) {
      const v = resolveMobileCheckoutItemsVisibility(n, false);
      expect(v.showAllLines).toBe(true);
      expect(v.showDisclosure).toBe(false);
      expect(n).toBeLessThanOrEqual(MOBILE_CHECKOUT_ITEMS_AUTO_SHOW_MAX);
    }
  });

  it("collapses 4+ products to a 3-row preview until expanded", () => {
    const collapsed = resolveMobileCheckoutItemsVisibility(4, false);
    expect(collapsed.showDisclosure).toBe(true);
    expect(collapsed.showAllLines).toBe(false);
    expect(collapsed.previewCount).toBe(MOBILE_CHECKOUT_ITEMS_COLLAPSED_PREVIEW);

    const expanded = resolveMobileCheckoutItemsVisibility(50, true);
    expect(expanded.showAllLines).toBe(true);
    expect(expanded.showDisclosure).toBe(true);
  });
});
