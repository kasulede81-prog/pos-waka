import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import {
  buildPosShelfDisplayCards,
  collectShelfCategoryKeys,
} from "./posShelfLayout";
import { productMatchesCategoryFilter, CATEGORY_FILTER_ALL } from "./productCategories";
import { isCatalogHierarchyEnabled } from "./catalogHierarchy";
import { effectiveShelfOrderKeys } from "./posShelfOrder";
import {
  buildProductSellSearchIndex,
  filterIndexedProductsForSellView,
  filterProductsByCategoryOnly,
} from "./posProductSearch";
import { resolveSellCatalogHierarchyView } from "./catalogBrowse";

function product(category: string, id: string, name = id): Product {
  return {
    id,
    name,
    category,
    sku: id,
    baseUnit: "piece",
    stockOnHand: 2,
    minimumStockAlert: 0,
    sellingPricePerUnitUgx: 1500,
    costPricePerUnitUgx: 900,
    sellingMode: "unit",
    updatedAt: "2026-08-01T00:00:00.000Z",
    version: 1,
  } as Product;
}

/**
 * Golden legacy test: introducing CatalogNode + a default-off flag must not
 * change shelf discovery, names, order, empty shelves, filtering, product IDs,
 * or product categories for an existing flat shop.
 */
describe("hierarchy flag OFF golden legacy shelves", () => {
  const products = [
    product("DELL", "p-dell", "Latitude 5420"),
    product("HP", "p-hp", "EliteBook"),
    product("LENOVO", "p-lenovo", "ThinkPad"),
  ];
  const layout = {
    Accessories: { color: "orange" as const, displayName: "Accessories" },
  };
  const orderKeys = ["DELL", "HP", "LENOVO", "Accessories"];
  const overlayNodes = [
    {
      id: "n-el",
      shopId: "shop-other",
      parentId: null,
      legacyShelfKey: "ELECTRONICS",
      name: "ELECTRONICS",
      sortOrder: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    {
      id: "n-dell",
      shopId: "shop-other",
      parentId: "n-el",
      legacyShelfKey: "ShouldNeverAppear",
      name: "ShouldNeverAppear",
      sortOrder: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ];

  it("defaults hierarchy OFF on a fresh shop", () => {
    expect(isCatalogHierarchyEnabled(createDefaultPreferences())).toBe(false);
  });

  it("shelf discovery, names, order, empty shelves, and filters match pre-hierarchy behavior", () => {
    const keys = collectShelfCategoryKeys(products, orderKeys, layout);
    expect(keys).toEqual(["DELL", "HP", "LENOVO", "Accessories"]);
    expect(effectiveShelfOrderKeys(keys, orderKeys)).toEqual(["DELL", "HP", "LENOVO", "Accessories"]);

    const cards = buildPosShelfDisplayCards(products, "No shelf", layout, orderKeys);
    expect(cards.map((c) => c.key)).toEqual(["DELL", "HP", "LENOVO", "Accessories"]);
    expect(cards.find((c) => c.key === "DELL")?.count).toBe(1);
    expect(cards.find((c) => c.key === "Accessories")?.count).toBe(0);
    expect(cards.find((c) => c.key === "ShouldNeverAppear")).toBeUndefined();
    expect(cards.find((c) => c.key === "ELECTRONICS")).toBeUndefined();

    expect(productMatchesCategoryFilter(products[0]!, "DELL")).toBe(true);
    expect(productMatchesCategoryFilter(products[0]!, "ELECTRONICS")).toBe(false);
    expect(productMatchesCategoryFilter(products[0]!, CATEGORY_FILTER_ALL)).toBe(true);

    const selected = products.filter((p) => productMatchesCategoryFilter(p, "DELL"));
    expect(selected.map((p) => p.id)).toEqual(["p-dell"]);

    expect(products.map((p) => p.id)).toEqual(["p-dell", "p-hp", "p-lenovo"]);
    expect(products.map((p) => p.category)).toEqual(["DELL", "HP", "LENOVO"]);

    // Overlay data present must not leak into discovery while the flag is unused.
    expect(overlayNodes.length).toBe(2);
    const keysWithUnusedOverlay = collectShelfCategoryKeys(products, orderKeys, layout);
    expect(keysWithUnusedOverlay).toEqual(keys);
  });

  it("legacy search still ignores the open shelf and does not change product selection", () => {
    const searchIndex = buildProductSellSearchIndex(products);
    const acrossShelves = filterIndexedProductsForSellView(
      searchIndex,
      "DELL",
      "EliteBook",
      [],
      new Set(),
    );
    expect(acrossShelves.map((p) => p.id)).toEqual(["p-hp"]);

    const dellOnly = filterProductsByCategoryOnly(products, "DELL", new Set());
    expect(dellOnly.map((p) => p.id)).toEqual(["p-dell"]);
    expect(productMatchesCategoryFilter(products[1]!, "DELL")).toBe(false);
  });

  it("flag-off Sell browsing does not require the hierarchy resolver", () => {
    expect(
      resolveSellCatalogHierarchyView({
        enabled: false,
        path: ["ELECTRONICS"],
        searchQuery: "",
        index: null,
        layout,
      }),
    ).toBeNull();
    const cards = buildPosShelfDisplayCards(products, "No shelf", layout, orderKeys);
    expect(cards.map((c) => c.key)).toEqual(["DELL", "HP", "LENOVO", "Accessories"]);
  });
});
