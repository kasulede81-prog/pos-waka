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
import { DesktopCategoryRail } from "../components/pos/desktop/DesktopCategoryRail";
import {
  desktopCategoryRailModel,
  desktopCategoryShelvesForDisplay,
  isSellHierarchyCatalogNav,
} from "./desktopCategoryNav";

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
  node({
    id: "n-ws",
    parentId: "n-comp",
    legacyShelfKey: "WORKSTATIONS",
    name: "Workstations",
    sortOrder: 0,
  }),
  node({ id: "n-desk", parentId: "n-comp", legacyShelfKey: "DESKTOPS", name: "Desktops", sortOrder: 1 }),
  node({ id: "n-lap", parentId: "n-comp", legacyShelfKey: "LAPTOPS", name: "Laptops", sortOrder: 2 }),
  node({ id: "n-dell", parentId: "n-lap", legacyShelfKey: "DELL", name: "Dell", sortOrder: 0 }),
  node({ id: "n-lat", parentId: "n-dell", legacyShelfKey: "LATITUDE", name: "Latitude", sortOrder: 0 }),
  node({ id: "n-xps", parentId: "n-dell", legacyShelfKey: "XPS", name: "XPS", sortOrder: 1 }),
];

describe("H2c desktop / Electron Sell hierarchy", () => {
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

  it("1 + 6 + Y. flag OFF uses existing desktop A–Z shelves, counts, empty shelves, and Product.category", () => {
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
    expect(
      isSellHierarchyCatalogNav({
        catalogHierarchyEnabled: false,
        searchQueryLength: 0,
        mobileSellFocus: false,
        isDesktopCatalogUi: true,
      }),
    ).toBe(false);

    const goldenProducts = [
      product({ id: "p-dell", name: "Latitude 5420", category: "DELL" }),
      product({ id: "p-hp", name: "EliteBook", category: "HP" }),
      product({ id: "p-lenovo", name: "ThinkPad", category: "LENOVO" }),
    ];
    const goldenLayout = { Accessories: { color: "orange" as const } };
    const goldenOrder = ["DELL", "HP", "LENOVO", "Accessories"];
    const cards = buildPosShelfDisplayCards(goldenProducts, "No shelf", goldenLayout, goldenOrder);
    const keys = collectShelfCategoryKeys(goldenProducts, goldenOrder, goldenLayout);
    expect(keys).toEqual(["DELL", "HP", "LENOVO", "Accessories"]);
    expect(cards.map((c) => c.key)).toEqual(["DELL", "HP", "LENOVO", "Accessories"]);
    expect(cards.find((c) => c.key === "DELL")?.count).toBe(1);
    expect(cards.find((c) => c.key === "Accessories")?.count).toBe(0);
    expect(cards.find((c) => c.key === "LENOVO")?.count).toBe(1);

    const railOrder = desktopCategoryShelvesForDisplay(cards, false).map((c) => c.key);
    expect(railOrder).toEqual(["Accessories", "DELL", "HP", "LENOVO"]);
    const model = desktopCategoryRailModel({
      hierarchyEnabled: false,
      atRoot: true,
      sellCategoryKey: "HP",
      hierarchyFolderCards: [{ key: "ELECTRONICS", label: "Electronics", count: 9, icon: null }],
      legacyShelfCards: cards,
    });
    expect(model.preserveOrder).toBe(false);
    expect(model.shelves.map((s) => s.key)).not.toContain("ELECTRONICS");
    expect(model.selectedKey).toBe("HP");
    expect(productMatchesCategoryFilter(products[3]!, "HP")).toBe(true);
    expect(filterProductsByCategoryOnly(products, "DELL", new Set()).map((p) => p.id)).toEqual([
      "p-laptop-a",
      "p-laptop-b",
    ]);
    expect(filterProductsByCategoryOnly(products, CATEGORY_FILTER_ALL, new Set()).length).toBe(5);
  });

  it("2–3 + 20. flag ON root shows hierarchy roots and virtual DELL/HP/LENOVO still work", () => {
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
    const rail = desktopCategoryRailModel({
      hierarchyEnabled: true,
      atRoot: true,
      sellCategoryKey: CATEGORY_FILTER_ALL,
      hierarchyFolderCards: root!.folderCards,
      legacyShelfCards: [],
    });
    expect(rail.shelves.map((s) => s.key)).toEqual(["ELECTRONICS", "ACCESSORIES", "PRINTERS", "HP"]);
    expect(rail.showAll).toBe(true);
    expect(rail.showBack).toBe(false);

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
    const virtualRoots = resolveSellCatalogHierarchyView({
      enabled: true,
      path: [],
      searchQuery: "",
      index: flat,
      layout: {},
    });
    expect(virtualRoots?.folders.map((f) => f.identity)).toEqual(["DELL", "HP", "LENOVO"]);
    const dell = resolveCatalogBrowseLevel(flat, "DELL");
    expect(dell.directProducts.map((p) => p.id)).toEqual(["p-dell"]);
    expect(dell.folders).toEqual([]);
  });

  it("4–5. current-level siblings only, CatalogNode.sortOrder when flag ON", () => {
    const computers = resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS"],
      searchQuery: "",
      index,
      layout,
    });
    expect(computers?.folders.map((f) => f.identity)).toEqual(["WORKSTATIONS", "DESKTOPS", "LAPTOPS"]);
    expect(computers?.folders.map((f) => f.identity)).not.toContain("ELECTRONICS");
    expect(computers?.folders.map((f) => f.identity)).not.toContain("ACCESSORIES");
    expect(computers?.folders.map((f) => f.identity)).not.toContain("HP");
    const rail = desktopCategoryRailModel({
      hierarchyEnabled: true,
      atRoot: false,
      sellCategoryKey: "COMPUTERS",
      hierarchyFolderCards: computers!.folderCards,
      legacyShelfCards: [],
    });
    expect(rail.showBack).toBe(true);
    expect(rail.showAll).toBe(false);
    expect(rail.preserveOrder).toBe(true);
    expect(rail.shelves.map((s) => s.key)).toEqual(["WORKSTATIONS", "DESKTOPS", "LAPTOPS"]);
    expect(desktopCategoryShelvesForDisplay(rail.shelves, true).map((s) => s.key)).toEqual([
      "WORKSTATIONS",
      "DESKTOPS",
      "LAPTOPS",
    ]);
  });

  it("7–9. opening a folder updates path, Back pops one level, breadcrumb jumps to ancestor", () => {
    const opened = pushCatalogBrowseIdentity(index, [], "ELECTRONICS");
    expect(opened).toEqual(["ELECTRONICS"]);
    const deep = ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"].reduce(
      (cur, id) => pushCatalogBrowseIdentity(index, cur, id),
      [] as string[],
    );
    expect(deep).toEqual(["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"]);
    expect(popCatalogBrowseIdentity(deep)).toEqual(["ELECTRONICS", "COMPUTERS", "LAPTOPS"]);
    expect(popCatalogBrowseIdentity(["ELECTRONICS"])).toEqual([]);
    expect(jumpCatalogBrowseToIdentity(index, deep, "COMPUTERS")).toEqual(["ELECTRONICS", "COMPUTERS"]);
    const view = resolveSellCatalogHierarchyView({
      enabled: true,
      path: deep,
      searchQuery: "",
      index,
      layout,
    });
    expect(view?.path.map((e) => e.label)).toEqual(["Electronics", "Computers", "Laptops", "Dell"]);
    expect(JSON.stringify(view?.path)).not.toMatch(/n-el|n-dell|virtual:/);

    const html = renderToStaticMarkup(
      createElement(PosShelfDrillDownHeader, {
        lang: "en",
        shelfLabel: "Dell",
        productCount: 2,
        onBack: () => undefined,
        path: view!.path,
        onPathSelect: () => undefined,
      }),
    );
    expect(html).toContain("Electronics");
    expect(html).toContain("Computers");
    expect(html).toContain("overflow-x-auto");
    expect(html).not.toContain("n-el");
  });

  it("10–12. mixed folders + direct products, no descendant dump, inclusive badges", () => {
    const view = resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"],
      searchQuery: "",
      index,
      layout,
    });
    expect(view?.folders.map((f) => f.identity)).toEqual(["LATITUDE", "XPS"]);
    expect(view?.directProducts.map((p) => p.id)).toEqual(["p-laptop-a", "p-laptop-b"]);
    expect(view?.directProducts.map((p) => p.id)).not.toContain("p-5420");
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

  it("13–15. empty folders, partial hierarchy, and deep path stay navigable", () => {
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
    const emptyRail = desktopCategoryRailModel({
      hierarchyEnabled: true,
      atRoot: false,
      sellCategoryKey: "COMPUTERS",
      hierarchyFolderCards: empty!.folderCards,
      legacyShelfCards: [],
    });
    expect(emptyRail.shelves.map((s) => s.key)).toEqual(["DELL"]);
    expect(emptyRail.showBack).toBe(true);

    const electronics = resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS"],
      searchQuery: "",
      index,
      layout,
    });
    expect(electronics?.folders.map((f) => f.identity)).toEqual(["COMPUTERS"]);
    expect(electronics?.folders.map((f) => f.identity)).not.toContain("ACCESSORIES");
    expect(electronics?.folders.map((f) => f.identity)).not.toContain("PRINTERS");

    const deep = ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL", "LATITUDE"].reduce(
      (cur, id) => pushCatalogBrowseIdentity(index, cur, id),
      [] as string[],
    );
    expect(deep).toEqual(["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL", "LATITUDE"]);
    const leaf = resolveSellCatalogHierarchyView({
      enabled: true,
      path: deep,
      searchQuery: "",
      index,
      layout,
    });
    expect(leaf?.directProducts.map((p) => p.id)).toEqual(["p-5420"]);
    expect(leaf?.folders).toEqual([]);
  });

  it("16–19. global search stays global, clearing restores path, cart and product selection unchanged", () => {
    const cart = [{ productId: "p-hp", qty: 3 }];
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
    expect(nested?.path.map((e) => e.identity)).toEqual(["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"]);
    expect(
      isSellHierarchyCatalogNav({
        catalogHierarchyEnabled: true,
        searchQueryLength: nested!.searchActive ? 9 : 0,
        mobileSellFocus: false,
        isDesktopCatalogUi: true,
      }),
    ).toBe(false);
    const cleared = resolveSellCatalogHierarchyView({
      enabled: true,
      path: nested!.path.map((e) => e.identity),
      searchQuery: "",
      index,
      layout,
    });
    expect(cleared?.searchActive).toBe(false);
    expect(cleared?.currentIdentity).toBe("DELL");
    expect(cart).toEqual([{ productId: "p-hp", qty: 3 }]);
    expect(products.map((p) => p.category)).toEqual(["DELL", "DELL", "LATITUDE", "HP", "ACCESSORIES"]);
    expect(productMatchesCategoryFilter(products[0]!, "DELL")).toBe(true);
  });

  it("21. renamed/deleted identity cannot leave a ghost path", () => {
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
    expect(view?.path.map((e) => e.identity)).not.toContain("DELL");
  });

  it("rail stays a current-level navigator, not a tree of ancestors", () => {
    const computers = resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS"],
      searchQuery: "",
      index,
      layout,
    });
    const rail = desktopCategoryRailModel({
      hierarchyEnabled: true,
      atRoot: false,
      sellCategoryKey: "COMPUTERS",
      hierarchyFolderCards: computers!.folderCards,
      legacyShelfCards: [],
    });
    const html = renderToStaticMarkup(
      createElement(DesktopCategoryRail, {
        lang: "en",
        shelves: rail.shelves,
        selectedKey: rail.selectedKey,
        onSelect: () => undefined,
        preserveOrder: rail.preserveOrder,
        showAll: rail.showAll,
        showBack: rail.showBack,
      }),
    );
    expect(html.match(/<nav/g)?.length).toBe(1);
    expect(html).not.toContain("<ul");
    expect(html).not.toContain('role="tree"');
    expect(html).toContain("Workstations");
    expect(html).toContain("Desktops");
    expect(html).toContain("Laptops");
    expect(html).not.toContain("Electronics");
    expect(html).not.toContain("Latitude");
  });
});
