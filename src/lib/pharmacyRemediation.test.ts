import { describe, expect, it } from "vitest";
import { isPharmacyMode } from "./pharmacy";
import { pharmacyCostWarnings } from "./pharmacyCostIntegrity";
import type { Product } from "../types";

describe("pharmacy remediation — warnings and isolation", () => {
  it("sell below cost warning does not block", () => {
    const p: Product = {
      id: "x",
      name: "X",
      sellingMode: "unit",
      baseUnit: "tablet",
      costPricePerUnitUgx: 100,
      sellingPricePerUnitUgx: 80,
      stockOnHand: 1,
      minimumStockAlert: 0,
      category: "",
      sku: "",
      updatedAt: "",
      version: 1,
    };
    expect(pharmacyCostWarnings(p).some((w) => w.kind === "sell_below_cost")).toBe(true);
  });

  it("retail and hospitality are not pharmacy mode", () => {
    expect(isPharmacyMode("wholesale", false)).toBe(false);
    expect(isPharmacyMode("restaurant_bar", true)).toBe(false);
  });
});
