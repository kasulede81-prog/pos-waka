import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import {
  buildProductSellSearchIndex,
  filterIndexedProductsForSellView,
  filterProductsByCategoryOnly,
} from "./posProductSearch";

function mkProduct(i: number): Product {
  return {
    id: `p-${i}`,
    name: `Product ${i}`,
    sellingMode: "unit",
    baseUnit: "ea",
    sellingPricePerUnitUgx: 1_000,
    costPricePerUnitUgx: 700,
    stockOnHand: 10,
    minimumStockAlert: 2,
    category: i % 5 === 0 ? "Beverages" : "General",
    sku: `SKU-${i}`,
    updatedAt: "2026-07-10T00:00:00.000Z",
    version: 1,
  };
}

describe("posProductSearch", () => {
  function benchBest(fn: () => void, runs = 5): number {
    fn();
    let best = Infinity;
    for (let i = 0; i < runs; i += 1) {
      const start = performance.now();
      fn();
      best = Math.min(best, performance.now() - start);
    }
    return best;
  }

  it("filters 20k products by category under 220ms", () => {
    const products = Array.from({ length: 20_000 }, (_, i) => mkProduct(i));
    const index = buildProductSellSearchIndex(products);
    const elapsed = benchBest(() => filterProductsByCategoryOnly(products, "Beverages", new Set()));
    expect(filterProductsByCategoryOnly(products, "Beverages", new Set()).length).toBe(4_000);
    expect(elapsed).toBeLessThan(220);
    expect(index.entries.length).toBe(20_000);
  });

  it("indexed search stays responsive at 20k catalog", () => {
    const products = Array.from({ length: 20_000 }, (_, i) => mkProduct(i));
    const index = buildProductSellSearchIndex(products);
    const elapsed = benchBest(() =>
      filterIndexedProductsForSellView(index, "__waka_all__", "Product 1999", [], new Set()),
    );
    const out = filterIndexedProductsForSellView(index, "__waka_all__", "Product 1999", [], new Set());
    expect(out.some((p) => p.id === "p-1999")).toBe(true);
    expect(elapsed).toBeLessThan(220);
  });
});
