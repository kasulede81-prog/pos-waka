import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogNode, Product } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import { LOCAL_CATALOG_SHOP_ID } from "./catalogHierarchy";
import { isCatalogHierarchyEnabled } from "./catalogHierarchy";
import {
  buildPosShelfDisplayCards,
  collectShelfCategoryKeys,
} from "./posShelfLayout";
import {
  CATEGORY_FILTER_ALL,
  productMatchesCategoryFilter,
} from "./productCategories";
import {
  buildProductSellSearchIndex,
  filterIndexedProductsForSellView,
  filterProductsByCategoryOnly,
} from "./posProductSearch";
import {
  buildCatalogBrowseIndex,
  jumpCatalogBrowseToIdentity,
  popCatalogBrowseIdentity,
  pushCatalogBrowseIdentity,
  resolveCatalogBrowseLevel,
  resolveSellCatalogHierarchyView,
} from "./catalogBrowse";
import { PosShelfDrillDownHeader } from "../components/pos/PosShelfDrillDownHeader";

function product(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    category: "",
    sku: partial.id,
    baseUnit: "piece",
    stockOnHand: 4,
    minimumStockAlert: 0,
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 500,
    sellingMode: "unit",
    updatedAt: "2026-08-01T00:00:00.000Z",
    version: 1,
    ...partial,
  } as Product;
}

function node(partial: Partial<CatalogNode> & Pick<CatalogNode, "id" | "legacyShelfKey">): CatalogNode {
  return {
    shopId: LOCAL_CATALOG_SHOP_ID,
    parentId: null,
    name: partial.legacyShelfKey,
    sortOrder: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

const electronicsTree: CatalogNode[] = [
  node({ id: "n-el", legacyShelfKey: "ELECTRONICS", name: "Electronics", sortOrder: 0 }),
  node({ id: "n-comp", parentId: "n-el", legacyShelfKey: "COMPUTERS", name: "Computers", sortOrder: 0 }),
  node({ id: "n-lap", parentId: "n-comp", legacyShelfKey: "LAPTOPS", name: "Laptops", sortOrder: 0 }),
  node({ id: "n-dell", parentId: "n-lap", legacyShelfKey: "DELL", name: "Dell", sortOrder: 0 }),
  node({ id: "n-lat", parentId: "n-dell", legacyShelfKey: "LATITUDE", name: "Latitude", sortOrder: 0 }),
  node({ id: "n-xps", parentId: "n-dell", legacyShelfKey: "XPS", name: "XPS", sortOrder: 1 }),
];

describe("H2b mobile Sell hierarchy view", () => {
  const products = [
    product({ id: "p-laptop-a", name: "Dell Laptop A", category: "DELL" }),
    product({ id: "p-laptop-b", name: "Dell Laptop B", category: "DELL" }),
    product({ id: "p-5420", name: "Latitude 5420", category: "LATITUDE" }),
    product({ id: "p-hp", name: "EliteBook", category: "HP" }),
    product({ id: "p-acc", name: "Mouse", category: "ACCESSORIES" }),
  ];
  const layout = {
    ACCESSORIES: { color: "orange" as const },
    PRINTERS: { color: "blue" as const },
  };
  const nodes = [
    ...electronicsTree,
    node({ id: "n-acc", legacyShelfKey: "ACCESSORIES", sortOrder: 1 }),
  ];

  const index = buildCatalogBrowseIndex({
    products,
    layout,
    orderKeys: ["ACCESSORIES", "PRINTERS"],
    nodes,
    shopId: LOCAL_CATALOG_SHOP_ID,
  });

  it("1. hierarchy OFF does not use the resolver and keeps existing shelves", () => {
    expect(isCatalogHierarchyEnabled(createDefaultPreferences())).toBe(false);
    expect(
      resolveSellCatalogHierarchyView({
        enabled: false,
        path: [],
        searchQuery: "",
        index,
        layout,
      }),
    ).toBeNull();
    const cards = buildPosShelfDisplayCards(products, "No shelf", layout, [
      "DELL",
      "HP",
      "LENOVO",
      "Accessories",
    ]);
    const keys = collectShelfCategoryKeys(products, ["DELL", "HP", "LENOVO", "Accessories"], {
      Accessories: { color: "orange" },
    });
    expect(keys).toEqual(expect.arrayContaining(["DELL", "HP", "ACCESSORIES"]));
    expect(cards.find((c) => c.key === "DELL")?.count).toBe(2);
  });

  it("2–3. hierarchy ON shows persisted roots and virtual legacy shelves", () => {
    const root = resolveSellCatalogHierarchyView({
      enabled: true,
      path: [],
      searchQuery: "",
      index,
      layout,
    });
    expect(root?.atRoot).toBe(true);
    expect(root?.folders.map((f) => f.identity)).toEqual([
      "ELECTRONICS",
      "ACCESSORIES",
      "PRINTERS",
      "HP",
    ]);
    expect(root?.folderCards.find((c) => c.key === "HP")?.count).toBe(1);
  });

  it("4–7. opening a folder pushes identity, shows children and direct products, not descendants", () => {
    const cart = [{ productId: "p-hp", qty: 3 }];
    const path = pushCatalogBrowseIdentity(index, [], "ELECTRONICS");
    expect(path).toEqual(["ELECTRONICS"]);
    const dellPath = ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"].reduce(
      (cur, id) => pushCatalogBrowseIdentity(index, cur, id),
      [] as string[],
    );
    const view = resolveSellCatalogHierarchyView({
      enabled: true,
      path: dellPath,
      searchQuery: "",
      index,
      layout,
    });
    expect(view?.folders.map((f) => f.identity)).toEqual(["LATITUDE", "XPS"]);
    expect(view?.directProducts.map((p) => p.id)).toEqual(["p-laptop-a", "p-laptop-b"]);
    expect(view?.directProducts.map((p) => p.id)).not.toContain("p-5420");
    expect(cart).toEqual([{ productId: "p-hp", qty: 3 }]);
    expect(products.map((p) => p.category)).toEqual([
      "DELL",
      "DELL",
      "LATITUDE",
      "HP",
      "ACCESSORIES",
    ]);
  });

  it("8–9. mixed node and inclusive folder badges", () => {
    const view = resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"],
      searchQuery: "",
      index,
      layout,
    });
    expect(view?.folderCards.find((c) => c.key === "LATITUDE")?.count).toBe(1);
    expect(view?.folderCards.find((c) => c.key === "XPS")?.count).toBe(0);
    const laptops = resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS", "LAPTOPS"],
      searchQuery: "",
      index,
      layout,
    });
    expect(laptops?.folderCards.find((c) => c.key === "DELL")?.count).toBe(3);
    expect(laptops?.directProducts).toEqual([]);
  });

  it("10–13. back pops one level and path/ancestor jump work", () => {
    const path = ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"];
    expect(popCatalogBrowseIdentity(path)).toEqual(["ELECTRONICS", "COMPUTERS", "LAPTOPS"]);
    expect(popCatalogBrowseIdentity(["ELECTRONICS"])).toEqual([]);
    expect(jumpCatalogBrowseToIdentity(index, path, "COMPUTERS")).toEqual([
      "ELECTRONICS",
      "COMPUTERS",
    ]);
    const view = resolveSellCatalogHierarchyView({
      enabled: true,
      path,
      searchQuery: "",
      index,
      layout,
    });
    expect(view?.path.map((e) => e.label)).toEqual([
      "Electronics",
      "Computers",
      "Laptops",
      "Dell",
    ]);
    expect(JSON.stringify(view?.path)).not.toMatch(/n-el|n-dell/);
  });

  it("14–16. search stays global and clearing search keeps the path", () => {
    const searchIndex = buildProductSellSearchIndex(products);
    const hits = filterIndexedProductsForSellView(searchIndex, "DELL", "EliteBook", [], new Set());
    expect(hits.map((p) => p.id)).toEqual(["p-hp"]);
    const nested = resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"],
      searchQuery: "EliteBook",
      index,
      layout,
    });
    expect(nested?.searchActive).toBe(true);
    expect(nested?.path.map((e) => e.identity)).toEqual([
      "ELECTRONICS",
      "COMPUTERS",
      "LAPTOPS",
      "DELL",
    ]);
    const cleared = resolveSellCatalogHierarchyView({
      enabled: true,
      path: nested!.path.map((e) => e.identity),
      searchQuery: "",
      index,
      layout,
    });
    expect(cleared?.searchActive).toBe(false);
    expect(cleared?.currentIdentity).toBe("DELL");
  });

  it("18–20. empty folders, partial hierarchy, and flat virtual shelves stay usable", () => {
    const emptyIndex = buildCatalogBrowseIndex({
      products: [],
      layout: {},
      orderKeys: [],
      nodes: [
        node({ id: "n-el", legacyShelfKey: "ELECTRONICS" }),
        node({ id: "n-comp", parentId: "n-el", legacyShelfKey: "COMPUTERS" }),
        node({ id: "n-dell", parentId: "n-comp", legacyShelfKey: "DELL" }),
      ],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    const empty = resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS"],
      searchQuery: "",
      index: emptyIndex,
      layout: {},
    });
    expect(empty?.folders.map((f) => f.identity)).toEqual(["DELL"]);
    expect(empty?.folderCards[0]?.count).toBe(0);
    expect(empty?.directProducts).toEqual([]);

    const flat = buildCatalogBrowseIndex({
      products: [
        product({ id: "p-dell", name: "Latitude 5420", category: "DELL" }),
        product({ id: "p-hp", name: "EliteBook", category: "HP" }),
        product({ id: "p-lenovo", name: "ThinkPad", category: "LENOVO" }),
      ],
      layout: {},
      orderKeys: ["DELL", "HP", "LENOVO"],
      nodes: [],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    const roots = resolveSellCatalogHierarchyView({
      enabled: true,
      path: [],
      searchQuery: "",
      index: flat,
      layout: {},
    });
    expect(roots?.folders.map((f) => f.identity)).toEqual(["DELL", "HP", "LENOVO"]);
    const dell = resolveCatalogBrowseLevel(flat, "DELL");
    expect(dell.directProducts.map((p) => p.id)).toEqual(["p-dell"]);
  });

  it("21–22. deleted identity pops back and deep hierarchy still resolves", () => {
    const withoutDell = buildCatalogBrowseIndex({
      products,
      layout,
      orderKeys: ["ACCESSORIES", "PRINTERS"],
      nodes: electronicsTree.filter((n) => n.legacyShelfKey !== "DELL" && n.parentId !== "n-dell"),
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    const view = resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"],
      searchQuery: "",
      index: withoutDell,
      layout,
    });
    expect(view?.currentIdentity).toBe("LAPTOPS");

    const deep = ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL", "LATITUDE"].reduce(
      (cur, id) => pushCatalogBrowseIdentity(index, cur, id),
      [] as string[],
    );
    expect(deep).toEqual(["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL", "LATITUDE"]);
  });

  it("23–25. product selection semantics, categories, and inventory stay read-only", () => {
    const p = products[0]!;
    expect(productMatchesCategoryFilter(p, "DELL")).toBe(true);
    expect(filterProductsByCategoryOnly(products, "DELL", new Set()).map((row) => row.id)).toEqual([
      "p-laptop-a",
      "p-laptop-b",
    ]);
    const stockSnap = products.map((row) => row.stockOnHand);
    resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS"],
      searchQuery: "",
      index,
      layout,
    });
    expect(products.map((row) => row.stockOnHand)).toEqual(stockSnap);
    expect(products.map((row) => row.category)).toEqual([
      "DELL",
      "DELL",
      "LATITUDE",
      "HP",
      "ACCESSORIES",
    ]);
    expect(filterProductsByCategoryOnly(products, CATEGORY_FILTER_ALL, new Set()).length).toBe(5);
  });

  it("path row scrolls independently and does not expose UUIDs", () => {
    const html = renderToStaticMarkup(
      createElement(PosShelfDrillDownHeader, {
        lang: "en",
        shelfLabel: "Dell",
        productCount: 2,
        onBack: () => undefined,
        path: [
          { identity: "ELECTRONICS", label: "Electronics" },
          { identity: "COMPUTERS", label: "Computers" },
          { identity: "LAPTOPS", label: "Laptops" },
          { identity: "DELL", label: "Dell" },
        ],
        onPathSelect: () => undefined,
      }),
    );
    expect(html).toContain("overflow-x-auto");
    expect(html).not.toContain("n-el");
    expect(html).toContain("Electronics");
    expect(html).toContain("min-w-0");
  });
});
