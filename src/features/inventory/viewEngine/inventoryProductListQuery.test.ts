import { describe, expect, it } from "vitest";
import type { Product } from "../../../types";
import { CATEGORY_FILTER_ALL } from "../../../lib/productCategories";
import { buildProductSellSearchIndex, queryInventoryProducts } from "./inventoryProductListQuery";

function mkProduct(i: number, overrides: Partial<Product> = {}): Product {
  return {
    id: `p-${i}`,
    name: `Product ${i}`,
    sellingMode: "unit",
    baseUnit: "ea",
    sellingPricePerUnitUgx: 1_000,
    costPricePerUnitUgx: 700,
    stockOnHand: i % 7 === 0 ? 1 : 10,
    minimumStockAlert: 2,
    category: i % 5 === 0 ? "Beverages" : "General",
    sku: `SKU-${i}`,
    updatedAt: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    version: 1,
    ...overrides,
  };
}

describe("queryInventoryProducts", () => {
  const products = Array.from({ length: 50 }, (_, i) => mkProduct(i));
  const index = buildProductSellSearchIndex(products);

  it("returns all products when query and filters are empty", () => {
    const out = queryInventoryProducts({
      products,
      query: "",
      categoryFilter: CATEGORY_FILTER_ALL,
      listFilter: "all",
      sort: "name_az",
      index,
    });
    expect(out).toHaveLength(50);
    expect(out[0]?.name).toBe("Product 0");
  });

  it("filters by indexed search query", () => {
    const out = queryInventoryProducts({
      products,
      query: "SKU-42",
      categoryFilter: CATEGORY_FILTER_ALL,
      listFilter: "all",
      sort: "name_az",
      index,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("p-42");
  });

  it("filters low stock only", () => {
    const out = queryInventoryProducts({
      products,
      query: "",
      categoryFilter: CATEGORY_FILTER_ALL,
      listFilter: "low",
      sort: "name_az",
      index,
    });
    expect(out.every((p) => p.stockOnHand <= p.minimumStockAlert)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it("sorts by stock ascending", () => {
    const out = queryInventoryProducts({
      products,
      query: "",
      categoryFilter: CATEGORY_FILTER_ALL,
      listFilter: "all",
      sort: "stock_low",
      index,
    });
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i]!.stockOnHand).toBeGreaterThanOrEqual(out[i - 1]!.stockOnHand);
    }
  });
});
