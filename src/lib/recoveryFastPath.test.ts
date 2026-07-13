import { describe, expect, it } from "vitest";
import { isSmallShopFastPathEligible } from "./recoveryFastPath";

describe("recoveryFastPath", () => {
  it("accepts small shops", () => {
    expect(isSmallShopFastPathEligible({ products: 20, customers: 2, sales: 92 })).toBe(true);
  });

  it("rejects large catalogs", () => {
    expect(isSmallShopFastPathEligible({ products: 501, customers: 2, sales: 0 })).toBe(false);
  });
});
