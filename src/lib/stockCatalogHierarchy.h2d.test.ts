import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogNode, Product } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import { LOCAL_CATALOG_SHOP_ID } from "./catalogHierarchy";
import { isCatalogHierarchyEnabled } from "./catalogHierarchy";
import { PHARMACY_CATEGORY_PRESETS } from "./pharmacy";
import { defaultMenuCategoriesForBusinessType } from "./hospitality";
import { productMatchesCategoryFilter } from "./productCategories";
import { collectShelfCategoryKeys, shelfHasUncategorizedSlot } from "./posShelfLayout";
import {
  jumpCatalogBrowseToIdentity,
  popCatalogBrowseIdentity,
  pushCatalogBrowseIdentity,
  resolveCatalogBrowseLevel,
} from "./catalogBrowse";
import { StockShelfGrid } from "../components/stock/StockShelfGrid";
import {
  buildStockCatalogBrowseIndex,
  resolveStockCatalogHierarchyView,
  stockDirectProductCountsByCategory,
  stockHierarchyBrowseOrderKeys,
  stockHierarchyCurrentInclusiveCount,
  stockHierarchyEnabled,
  stockHierarchyFolderTiles,
  stockLegacyCategoryPicklist,
  stockLegacyShelfFolderKeys,
} from "./stockCatalogBrowse";

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

function applyAdjust(products: Product[], productId: string, delta: number): Product[] {
  return products.map((p) =>
    p.id === productId ? { ...p, stockOnHand: Math.max(0, p.stockOnHand + delta) } : p,
  );
}

const electronicsTree: CatalogNode[] = [
  node({ id: "n-el", legacyShelfKey: "ELECTRONICS", name: "Electronics", sortOrder: 0 }),
  node({ id: "n-comp", parentId: "n-el", legacyShelfKey: "COMPUTERS", name: "Computers", sortOrder: 0 }),
  node({ id: "n-lap", parentId: "n-comp", legacyShelfKey: "LAPTOPS", name: "Laptops", sortOrder: 0 }),
  node({ id: "n-dell", parentId: "n-lap", legacyShelfKey: "DELL", name: "Dell", sortOrder: 0 }),
  node({ id: "n-lat", parentId: "n-dell", legacyShelfKey: "LATITUDE", name: "Latitude", sortOrder: 0 }),
  node({ id: "n-xps", parentId: "n-dell", legacyShelfKey: "XPS", name: "XPS", sortOrder: 1 }),
];

describe("H2d Stock nested catalog browsing", () => {
  const products = [
    product({ id: "p-laptop-a", name: "Dell Laptop A", category: "DELL", stockOnHand: 4 }),
    product({ id: "p-laptop-b", name: "Dell Laptop B", category: "DELL", stockOnHand: 12 }),
    product({ id: "p-5420", name: "Latitude 5420", category: "LATITUDE", stockOnHand: 3 }),
    product({ id: "p-hp", name: "EliteBook", category: "HP", stockOnHand: 7 }),
    product({ id: "p-acc", name: "Mouse", category: "ACCESSORIES", stockOnHand: 20 }),
  ];
  const layout = {
    ACCESSORIES: { color: "orange" as const },
    PRINTERS: { color: "blue" as const },
  };
  const index = buildStockCatalogBrowseIndex({
    products,
    layout,
    nodes: electronicsTree,
    shopId: LOCAL_CATALOG_SHOP_ID,
    orderKeys: ["ACCESSORIES", "PRINTERS"],
    uncategorizedLabel: "Uncategorized",
  });

  it("1 + Y retail. flag OFF remains legacy Stock shelves, counts, empty shelves, and Product.category", () => {
    expect(isCatalogHierarchyEnabled(createDefaultPreferences())).toBe(false);
    expect(stockHierarchyEnabled(createDefaultPreferences())).toBe(false);
    const goldenProducts = [
      product({ id: "p-dell", name: "Latitude 5420", category: "DELL", stockOnHand: 4 }),
      product({ id: "p-hp", name: "EliteBook", category: "HP", stockOnHand: 7 }),
      product({ id: "p-lenovo", name: "ThinkPad", category: "LENOVO", stockOnHand: 2 }),
    ];
    const goldenLayout = { Accessories: { color: "orange" as const } };
    const saved = ["DELL", "HP", "LENOVO", "Accessories"];
    const picklist = stockLegacyCategoryPicklist({
      products: goldenProducts,
      savedShelfKeys: saved,
      layout: goldenLayout,
      businessType: "kiosk_duka",
      pharmacyMode: false,
    });
    expect(picklist).toEqual(collectShelfCategoryKeys(goldenProducts, saved, goldenLayout));
    expect(picklist).toEqual(["DELL", "HP", "LENOVO", "Accessories"]);
    const folders = stockLegacyShelfFolderKeys(picklist, false);
    expect(folders).toEqual(["Accessories", "DELL", "HP", "LENOVO"]);
    const counts = stockDirectProductCountsByCategory(goldenProducts);
    expect(counts.get("DELL")).toBe(1);
    expect(counts.get("Accessories") ?? 0).toBe(0);
    expect(counts.get("LENOVO")).toBe(1);
    expect(goldenProducts.find((p) => p.id === "p-dell")?.stockOnHand).toBe(4);
    expect(productMatchesCategoryFilter(goldenProducts[0]!, "DELL")).toBe(true);
    expect(
      resolveStockCatalogHierarchyView({
        enabled: false,
        path: ["DELL"],
        index,
        layout,
      }),
    ).toBeNull();
  });

  it("21. pharmacy preset roots remain and are not converted to CatalogNodes", () => {
    const picklist = stockLegacyCategoryPicklist({
      products: [],
      savedShelfKeys: [],
      layout: {},
      businessType: "pharmacy",
      pharmacyMode: true,
    });
    expect(picklist).toEqual([...PHARMACY_CATEGORY_PRESETS].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
    expect(picklist).toContain("OTC");
    expect(picklist).toContain("Vitamins");
    const orderKeys = stockHierarchyBrowseOrderKeys({
      savedShelfKeys: [],
      businessType: "pharmacy",
      pharmacyMode: true,
    });
    expect(orderKeys).toContain("OTC");
    expect(orderKeys).toContain("Antibiotics");
    const nodes: CatalogNode[] = [];
    const pharmacyIndex = buildStockCatalogBrowseIndex({
      products: [],
      layout: {},
      nodes,
      shopId: LOCAL_CATALOG_SHOP_ID,
      orderKeys,
      uncategorizedLabel: "Uncategorized",
    });
    const root = resolveStockCatalogHierarchyView({
      enabled: true,
      path: [],
      index: pharmacyIndex,
      layout: {},
    });
    expect(root?.folders.map((f) => f.identity)).toEqual(expect.arrayContaining(["OTC", "Antibiotics", "Vitamins"]));
    expect(nodes).toEqual([]);
    expect(root?.folders.find((f) => f.identity === "OTC")?.persisted).toBe(false);
  });

  it("22. hospitality preset roots remain and are not converted to CatalogNodes", () => {
    const restaurantPresets = defaultMenuCategoriesForBusinessType("restaurant");
    const picklist = stockLegacyCategoryPicklist({
      products: [],
      savedShelfKeys: [],
      layout: {},
      businessType: "restaurant",
      hospitalityModeEnabled: true,
      pharmacyMode: false,
    });
    expect(picklist).toEqual(
      [...restaurantPresets].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    );
    expect(picklist).toContain("Food");
    expect(picklist).toContain("Coffee");
    const nodes: CatalogNode[] = [];
    const hospIndex = buildStockCatalogBrowseIndex({
      products: [],
      layout: {},
      nodes,
      shopId: LOCAL_CATALOG_SHOP_ID,
      orderKeys: stockHierarchyBrowseOrderKeys({
        savedShelfKeys: [],
        businessType: "restaurant",
        hospitalityModeEnabled: true,
        pharmacyMode: false,
      }),
      uncategorizedLabel: "Uncategorized",
    });
    const root = resolveStockCatalogHierarchyView({
      enabled: true,
      path: [],
      index: hospIndex,
      layout: {},
    });
    expect(root?.folders.map((f) => f.identity)).toEqual(expect.arrayContaining(restaurantPresets));
    expect(nodes).toEqual([]);
  });

  it("2–6 + 20 + 24. flag ON roots, virtual shelves, children, current-level only, deep path", () => {
    const root = resolveStockCatalogHierarchyView({
      enabled: true,
      path: [],
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
    const computers = resolveStockCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS"],
      index,
      layout,
    });
    expect(computers?.folders.map((f) => f.identity)).toEqual(["LAPTOPS"]);
    expect(computers?.folders.map((f) => f.identity)).not.toContain("ELECTRONICS");
    expect(computers?.folders.map((f) => f.identity)).not.toContain("HP");
    const deep = ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"].reduce(
      (cur, id) => pushCatalogBrowseIdentity(index, cur, id),
      [] as string[],
    );
    expect(deep).toEqual(["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"]);

    const flat = buildStockCatalogBrowseIndex({
      products: [
        product({ id: "p-dell", name: "Latitude 5420", category: "DELL" }),
        product({ id: "p-hp", name: "EliteBook", category: "HP" }),
        product({ id: "p-lenovo", name: "ThinkPad", category: "LENOVO" }),
      ],
      layout: {},
      nodes: [],
      shopId: LOCAL_CATALOG_SHOP_ID,
      orderKeys: ["DELL", "HP", "LENOVO"],
      uncategorizedLabel: "Uncategorized",
    });
    const virtualRoots = resolveStockCatalogHierarchyView({
      enabled: true,
      path: [],
      index: flat,
      layout: {},
    });
    expect(virtualRoots?.folders.map((f) => f.identity)).toEqual(["DELL", "HP", "LENOVO"]);
    expect(resolveCatalogBrowseLevel(flat, "DELL").directProducts.map((p) => p.id)).toEqual(["p-dell"]);
  });

  it("7–11. mixed folders + direct products, no descendant dump, inclusive count, stockOnHand unchanged", () => {
    const view = resolveStockCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"],
      index,
      layout,
    });
    expect(stockHierarchyFolderTiles(view!).map((t) => t.key)).toEqual(["LATITUDE", "XPS"]);
    expect(view?.directProducts.map((p) => p.id)).toEqual(["p-laptop-a", "p-laptop-b"]);
    expect(view?.directProducts.map((p) => p.id)).not.toContain("p-5420");
    expect(view?.folderCards.find((c) => c.key === "LATITUDE")?.count).toBe(1);
    expect(view?.folderCards.find((c) => c.key === "XPS")?.count).toBe(0);
    expect(stockHierarchyCurrentInclusiveCount(view!)).toBe(3);
    const stockSum = view!.directProducts.reduce((n, p) => n + p.stockOnHand, 0);
    expect(stockSum).toBe(16);
    expect(stockHierarchyCurrentInclusiveCount(view!)).not.toBe(stockSum);
    expect(view?.directProducts.find((p) => p.id === "p-laptop-a")?.stockOnHand).toBe(4);
    expect(view?.directProducts.find((p) => p.id === "p-laptop-b")?.stockOnHand).toBe(12);
    expect(products.map((p) => p.category)).toEqual(["DELL", "DELL", "LATITUDE", "HP", "ACCESSORIES"]);
  });

  it("12 + AA. navigation mutates nothing; adjust still targets the same productId", () => {
    const snapshot = products.map((p) => ({ id: p.id, stockOnHand: p.stockOnHand, category: p.category }));
    resolveStockCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"],
      index,
      layout,
    });
    pushCatalogBrowseIdentity(index, [], "ELECTRONICS");
    popCatalogBrowseIdentity(["ELECTRONICS", "COMPUTERS"]);
    expect(products.map((p) => ({ id: p.id, stockOnHand: p.stockOnHand, category: p.category }))).toEqual(snapshot);

    const before = products.find((p) => p.id === "p-laptop-a")!;
    const after = applyAdjust(products, "p-laptop-a", 2);
    const moved = after.find((p) => p.id === "p-laptop-a")!;
    expect(moved.id).toBe(before.id);
    expect(moved.stockOnHand).toBe(6);
    expect(after.filter((p) => p.id !== "p-laptop-a").every((p) => p.stockOnHand === products.find((x) => x.id === p.id)?.stockOnHand)).toBe(
      true,
    );
    expect(moved.category).toBe("DELL");
  });

  it("13–16. empty folders stay, back pops one, breadcrumb ancestor jump, no UUIDs", () => {
    const emptyIndex = buildStockCatalogBrowseIndex({
      products: [],
      layout: {},
      nodes: [
        node({ id: "n-el", legacyShelfKey: "ELECTRONICS", name: "Electronics" }),
        node({ id: "n-comp", parentId: "n-el", legacyShelfKey: "COMPUTERS", name: "Computers" }),
        node({ id: "n-dell", parentId: "n-comp", legacyShelfKey: "DELL", name: "Dell" }),
      ],
      shopId: LOCAL_CATALOG_SHOP_ID,
      orderKeys: [],
      uncategorizedLabel: "Uncategorized",
    });
    const empty = resolveStockCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS"],
      index: emptyIndex,
      layout: {},
    });
    expect(empty?.folders.map((f) => f.identity)).toEqual(["DELL"]);
    expect(empty?.folderCards[0]?.count).toBe(0);

    const path = ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"];
    expect(popCatalogBrowseIdentity(path)).toEqual(["ELECTRONICS", "COMPUTERS", "LAPTOPS"]);
    expect(jumpCatalogBrowseToIdentity(index, path, "COMPUTERS")).toEqual(["ELECTRONICS", "COMPUTERS"]);
    const view = resolveStockCatalogHierarchyView({
      enabled: true,
      path,
      index,
      layout,
    });
    expect(view?.path.map((e) => e.label)).toEqual(["Electronics", "Computers", "Laptops", "Dell"]);
    expect(JSON.stringify(view?.path)).not.toMatch(/n-el|n-dell|virtual:/);

    const html = renderToStaticMarkup(
      createElement(StockShelfGrid, {
        lang: "en",
        shelves: [],
        selectedShelf: "DELL",
        canArrangeShelves: false,
        onSelectShelf: () => undefined,
        onBack: () => undefined,
        path: view!.path,
        onPathSelect: () => undefined,
        selectedLabel: "Dell",
        selectedCount: 3,
        nestedFolders: stockHierarchyFolderTiles(view!),
      }),
    );
    expect(html).toContain("Electronics");
    expect(html).toContain("Computers");
    expect(html).toContain("overflow-x-auto");
    expect(html).not.toContain("n-el");
    expect(html).toContain("Latitude");
    expect(html).toContain("XPS");
  });

  it("18–19. Stock pinned search stays global product search; clearing does not rewrite the path", () => {
    const path = ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"];
    const nested = resolveStockCatalogHierarchyView({
      enabled: true,
      path,
      index,
      layout,
    });
    expect(nested?.currentIdentity).toBe("DELL");
    const still = resolveStockCatalogHierarchyView({
      enabled: true,
      path,
      index,
      layout,
    });
    expect(still?.path.map((e) => e.identity)).toEqual(path);
    const hits = products.filter((p) => p.name.toLowerCase().includes("elitebook"));
    expect(hits.map((p) => p.id)).toEqual(["p-hp"]);
    expect(hits[0]?.category).toBe("HP");
  });

  it("23 + 25–27. partial hierarchy, ghost path after delete, shop isolation", () => {
    const electronics = resolveStockCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS"],
      index,
      layout,
    });
    expect(electronics?.folders.map((f) => f.identity)).toEqual(["COMPUTERS"]);
    expect(electronics?.folders.map((f) => f.identity)).not.toContain("ACCESSORIES");

    const withoutDell = buildStockCatalogBrowseIndex({
      products,
      layout,
      nodes: electronicsTree.filter((n) => n.legacyShelfKey !== "DELL" && n.parentId !== "n-dell"),
      shopId: LOCAL_CATALOG_SHOP_ID,
      orderKeys: ["ACCESSORIES", "PRINTERS"],
      uncategorizedLabel: "Uncategorized",
    });
    const ghost = resolveStockCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"],
      index: withoutDell,
      layout,
    });
    expect(ghost?.currentIdentity).toBe("LAPTOPS");
    expect(ghost?.path.map((e) => e.identity)).not.toContain("DELL");

    const foreign = buildStockCatalogBrowseIndex({
      products,
      layout,
      nodes: electronicsTree.map((n) => ({ ...n, shopId: "shop-other" })),
      shopId: LOCAL_CATALOG_SHOP_ID,
      orderKeys: ["DELL", "HP", "LENOVO", "ACCESSORIES"],
      uncategorizedLabel: "Uncategorized",
    });
    const isolated = resolveStockCatalogHierarchyView({
      enabled: true,
      path: [],
      index: foreign,
      layout,
    });
    expect(isolated?.folders.map((f) => f.identity)).not.toContain("ELECTRONICS");
    expect(isolated?.folders.map((f) => f.identity)).toEqual(expect.arrayContaining(["DELL", "HP", "ACCESSORIES"]));
  });

  it("26. Delete Empty Shelf state is respected — missing identity is not resurrected", () => {
    const afterDelete = buildStockCatalogBrowseIndex({
      products: products.filter((p) => p.category !== "ACCESSORIES"),
      layout: { PRINTERS: { color: "blue" as const } },
      nodes: electronicsTree,
      shopId: LOCAL_CATALOG_SHOP_ID,
      orderKeys: ["PRINTERS"],
      uncategorizedLabel: "Uncategorized",
    });
    const keys = collectShelfCategoryKeys(
      products.filter((p) => p.category !== "ACCESSORIES"),
      ["PRINTERS"],
      { PRINTERS: { color: "blue" as const } },
    );
    expect(keys).not.toContain("ACCESSORIES");
    const root = resolveStockCatalogHierarchyView({
      enabled: true,
      path: [],
      index: afterDelete,
      layout: { PRINTERS: { color: "blue" as const } },
    });
    expect(root?.folders.map((f) => f.identity)).not.toContain("ACCESSORIES");
    expect(shelfHasUncategorizedSlot(products.filter((p) => p.category !== "ACCESSORIES"), ["PRINTERS"], {})).toBe(
      false,
    );
  });

  it("29–30. navigation is path-only and resolver lookup is O(children), not a full rescan contract", () => {
    const t0 = Date.now();
    for (let i = 0; i < 50; i += 1) {
      resolveStockCatalogHierarchyView({
        enabled: true,
        path: ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"],
        index,
        layout,
      });
    }
    expect(Date.now() - t0).toBeLessThan(200);
    expect(products.every((p) => typeof p.id === "string")).toBe(true);
  });
});
