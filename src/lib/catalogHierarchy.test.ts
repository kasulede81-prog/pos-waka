import { describe, expect, it } from "vitest";
import type { CatalogNode, Product } from "../types";
import { UNCATEGORIZED_SENTINEL } from "./productCategories";
import { QUICK_SELL_SHELF_KEY, collectShelfCategoryKeys } from "./posShelfLayout";
import {
  applySharedCategoryToRows,
  assignmentCategoryFromPickerItem,
  buildCatalogPickerItems,
  catalogDescendantIds,
  catalogItemMatchesQuery,
  catalogNodesForShop,
  catalogShopIdFromPreferences,
  findCatalogPickerItemByIdentity,
  hierarchyPickerChrome,
  isCatalogHierarchyEnabled,
  LOCAL_CATALOG_SHOP_ID,
  catalogCreateInsideParentId,
  catalogCreateIntentParentId,
  catalogPickerItemsMatchingSection,
  expandAncestorsForCreatedFolder,
  nextDestinationAfterCatalogCreate,
  resolveCatalogSectionInput,
  normalizeCatalogNodes,
  planCreateCatalogNode,
  planCreateCatalogShelf,
  remapCatalogNodesForRename,
  retireCatalogNodesForDeletedShelf,
  searchCatalogPickerItems,
  selectedCatalogDestinationPath,
} from "./catalogHierarchy";

function product(category: string, id: string = crypto.randomUUID()): Product {
  return {
    id,
    name: id,
    category,
    sku: "",
    baseUnit: "piece",
    stockOnHand: 4,
    minimumStockAlert: 0,
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 500,
    sellingMode: "unit",
    updatedAt: "",
    version: 1,
  } as Product;
}

function node(partial: Partial<CatalogNode> & Pick<CatalogNode, "id" | "legacyShelfKey">): CatalogNode {
  return {
    shopId: LOCAL_CATALOG_SHOP_ID,
    parentId: null,
    name: partial.legacyShelfKey,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("catalog hierarchy feature flag", () => {
  it("defaults existing shops OFF when the flag is missing", () => {
    expect(isCatalogHierarchyEnabled(undefined)).toBe(false);
    expect(isCatalogHierarchyEnabled({})).toBe(false);
    expect(isCatalogHierarchyEnabled({ catalogHierarchyEnabled: false })).toBe(false);
    expect(isCatalogHierarchyEnabled({ catalogHierarchyEnabled: true })).toBe(true);
  });

  it("flag OFF uses the flat picker chrome", () => {
    expect(hierarchyPickerChrome(false)).toEqual({ showSearch: false, showCreate: false, mode: "flat" });
  });

  it("flag ON activates hierarchy-aware Add Product chrome", () => {
    expect(hierarchyPickerChrome(true)).toEqual({ showSearch: true, showCreate: true, mode: "hierarchy" });
  });

  it("hides Create when the actor cannot persist CatalogNodes", () => {
    expect(hierarchyPickerChrome(true, false)).toEqual({
      showSearch: true,
      showCreate: false,
      mode: "hierarchy",
    });
  });
});

describe("CatalogNode model", () => {
  it("creates a root node", () => {
    const plan = planCreateCatalogNode({
      name: "ELECTRONICS",
      parentId: null,
      nodes: [],
      shopId: "shop-a",
      id: "n-root",
      now: "2026-08-27T00:00:00.000Z",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.node.parentId).toBeNull();
    expect(plan.node.legacyShelfKey).toBe("ELECTRONICS");
    expect(plan.node.shopId).toBe("shop-a");
  });

  it("creates a child node under a parent", () => {
    const root = planCreateCatalogNode({
      name: "ELECTRONICS",
      parentId: null,
      nodes: [],
      shopId: "shop-a",
      id: "n-el",
    });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const child = planCreateCatalogNode({
      name: "COMPUTERS",
      parentId: root.node.id,
      nodes: root.nodes,
      shopId: "shop-a",
      id: "n-comp",
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    expect(child.node.parentId).toBe("n-el");
  });

  it("creates deeply nested nodes", () => {
    let nodes: CatalogNode[] = [];
    const names = ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL", "Latitude"];
    let parentId: string | null = null;
    for (const name of names) {
      const plan = planCreateCatalogNode({ name, parentId, nodes, shopId: "shop-a", id: `n-${name}` });
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      nodes = plan.nodes;
      parentId = plan.node.id;
    }
    expect(catalogDescendantIds(nodes, "n-ELECTRONICS")).toHaveLength(4);
    expect(nodes[nodes.length - 1]?.legacyShelfKey).toBe("Latitude");
  });

  it("isolates nodes by shop", () => {
    const a = node({ id: "a1", shopId: "shop-a", legacyShelfKey: "DELL" });
    const b = node({ id: "b1", shopId: "shop-b", legacyShelfKey: "HP" });
    expect(catalogNodesForShop([a, b], "shop-a").map((n) => n.id)).toEqual(["a1"]);
    expect(catalogNodesForShop([a, b], "shop-b").map((n) => n.id)).toEqual(["b1"]);
  });

  it("rejects a missing parent and keeps parent-child integrity", () => {
    const missing = planCreateCatalogNode({
      name: "Latitude",
      parentId: "ghost",
      nodes: [],
      shopId: "shop-a",
    });
    expect(missing).toEqual({ ok: false, errorKey: "catalogParentMissing" });
  });

  it("drops cyclic parents on normalize", () => {
    const cyclic = normalizeCatalogNodes(
      [
        { id: "a", shopId: "s", parentId: "b", legacyShelfKey: "A", name: "A", sortOrder: 0 },
        { id: "b", shopId: "s", parentId: "a", legacyShelfKey: "B", name: "B", sortOrder: 1 },
      ],
      "s",
    );
    expect(cyclic.every((n) => n.parentId == null || cyclic.some((p) => p.id === n.parentId))).toBe(true);
    expect(cyclic.some((n) => n.parentId === "a") && cyclic.some((n) => n.parentId === "b")).toBe(false);
  });

  it("assigns sort order among siblings", () => {
    const first = planCreateCatalogNode({ name: "DELL", parentId: null, nodes: [], shopId: "s", id: "1" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = planCreateCatalogNode({
      name: "HP",
      parentId: null,
      nodes: first.nodes,
      shopId: "s",
      id: "2",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(first.node.sortOrder).toBe(0);
    expect(second.node.sortOrder).toBe(1);
  });

  it("refuses reserved identities", () => {
    expect(planCreateCatalogNode({ name: UNCATEGORIZED_SENTINEL, parentId: null, nodes: [], shopId: "s" }).ok).toBe(
      false,
    );
    expect(planCreateCatalogNode({ name: QUICK_SELL_SHELF_KEY, parentId: null, nodes: [], shopId: "s" }).ok).toBe(
      false,
    );
  });
});

describe("product compatibility", () => {
  it("does not rewrite Product.category when creating a node", () => {
    const products = [product("DELL", "p1")];
    const snapshot = products.map((p) => ({ ...p }));
    const plan = planCreateCatalogShelf({
      name: "ELECTRONICS",
      parentId: null,
      nodes: [],
      shopId: "s",
      layout: {},
      orderKeys: [],
    });
    expect(plan.ok).toBe(true);
    expect(products).toEqual(snapshot);
    expect(products[0]?.id).toBe("p1");
    expect(products[0]?.category).toBe("DELL");
    expect(products[0]?.stockOnHand).toBe(4);
  });

  it("associates a product with a node via the existing category identity", () => {
    const dell = node({ id: "n-dell", legacyShelfKey: "DELL", parentId: "n-el", name: "DELL" });
    const items = buildCatalogPickerItems({
      products: [product("DELL")],
      layout: {},
      orderKeys: [],
      nodes: [node({ id: "n-el", legacyShelfKey: "ELECTRONICS", name: "ELECTRONICS" }), dell],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    const picked = items.find((i) => i.id === "n-dell");
    expect(picked).toBeTruthy();
    expect(assignmentCategoryFromPickerItem(picked!)).toBe("DELL");
  });
});

describe("Add Product picker search and create", () => {
  it("search finds a nested destination by leaf and by path", () => {
    const nodes: CatalogNode[] = [
      node({ id: "n-el", legacyShelfKey: "ELECTRONICS", name: "ELECTRONICS" }),
      node({ id: "n-comp", parentId: "n-el", legacyShelfKey: "COMPUTERS", name: "COMPUTERS", sortOrder: 0 }),
      node({ id: "n-lap", parentId: "n-comp", legacyShelfKey: "LAPTOPS", name: "LAPTOPS", sortOrder: 0 }),
      node({ id: "n-dell", parentId: "n-lap", legacyShelfKey: "DELL", name: "DELL", sortOrder: 0 }),
      node({ id: "n-lat", parentId: "n-dell", legacyShelfKey: "Latitude", name: "Latitude", sortOrder: 0 }),
    ];
    const items = buildCatalogPickerItems({
      products: [],
      layout: {},
      orderKeys: [],
      nodes,
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    const leaf = items.find((i) => i.legacyShelfKey === "Latitude");
    expect(leaf).toBeTruthy();
    expect(catalogItemMatchesQuery(leaf!, "latitude")).toBe(true);
    expect(searchCatalogPickerItems(items, "latitude").some((i) => i.legacyShelfKey === "Latitude")).toBe(true);
    const path = items.filter((i) => catalogItemMatchesQuery(i, "Dell Latitude"));
    expect(path.some((i) => i.legacyShelfKey === "Latitude")).toBe(true);
    expect(selectedCatalogDestinationPath(items, "Latitude")).toBe(
      "ELECTRONICS / COMPUTERS / LAPTOPS / DELL / Latitude",
    );
    expect(assignmentCategoryFromPickerItem(leaf!)).toBe("Latitude");
    expect(assignmentCategoryFromPickerItem(leaf!)).not.toContain("/");
    expect(findCatalogPickerItemByIdentity(items, "latitude")?.legacyShelfKey).toBe("Latitude");
  });

  it("create plan selects the new identity and can nest under a parent", () => {
    const parent = planCreateCatalogNode({
      name: "LAPTOPS",
      parentId: null,
      nodes: [],
      shopId: LOCAL_CATALOG_SHOP_ID,
      id: "n-lap",
    });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const created = planCreateCatalogShelf({
      name: "DELL",
      parentId: parent.node.id,
      nodes: parent.nodes,
      shopId: LOCAL_CATALOG_SHOP_ID,
      layout: {},
      orderKeys: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.node.parentId).toBe("n-lap");
    expect(created.node.legacyShelfKey).toBe("DELL");
    expect(created.layout.DELL).toBeTruthy();
    expect(created.orderKeys).toContain("DELL");
  });

  it("create failure keeps the current destination and does not assign the typed name", () => {
    expect(
      nextDestinationAfterCatalogCreate({
        ok: false,
        legacyShelfKey: undefined,
        currentValue: "LATITUDE",
      }),
    ).toEqual({ value: "LATITUDE", assigned: false });
    expect(
      nextDestinationAfterCatalogCreate({
        ok: false,
        currentValue: "LATITUDE",
      }).value,
    ).not.toBe("INSPIRON");
    expect(
      nextDestinationAfterCatalogCreate({
        ok: true,
        legacyShelfKey: "LATITUDE",
        currentValue: "DELL",
      }),
    ).toEqual({ value: "LATITUDE", assigned: true });
  });
});

describe("folder create UX helpers", () => {
  it("top-level create ignores the selected folder", () => {
    expect(catalogCreateIntentParentId("top-level", "n-el")).toBeNull();
    expect(catalogCreateIntentParentId("top-level", null)).toBeNull();
  });

  it("add-child uses the selected persisted folder as parent", () => {
    expect(catalogCreateIntentParentId("child", "n-el")).toBe("n-el");
    expect(catalogCreateIntentParentId("child", "  ")).toBeNull();
    expect(catalogCreateIntentParentId("child", null)).toBeNull();
  });

  it("Add Product create-inside uses the selected persisted folder, else top level", () => {
    expect(catalogCreateInsideParentId({ id: "n-dell", persisted: true })).toBe("n-dell");
    expect(catalogCreateInsideParentId({ id: "virtual-DELL", persisted: false })).toBe("");
    expect(catalogCreateInsideParentId(null)).toBe("");
  });

  it("expands every ancestor so a new child is visible", () => {
    const nodes = [
      node({ id: "n-el", legacyShelfKey: "Electronics" }),
      node({ id: "n-comp", parentId: "n-el", legacyShelfKey: "Computers" }),
      node({ id: "n-lap", parentId: "n-comp", legacyShelfKey: "Laptops" }),
    ];
    const expanded = expandAncestorsForCreatedFolder(nodes, "n-lap", new Set());
    expect(expanded.has("n-el")).toBe(true);
    expect(expanded.has("n-comp")).toBe(true);
    expect(expanded.has("n-lap")).toBe(true);
  });
});

describe("product-set shared category", () => {
  it("applies one shelf to every row when the set flow shares a destination", () => {
    const rows = [
      { name: "A", category: "General" },
      { name: "B", category: "Snacks" },
    ];
    expect(applySharedCategoryToRows(rows, "DELL").map((r) => r.category)).toEqual(["DELL", "DELL"]);
  });

  it("preserves per-product category when a row is not selected", () => {
    const rows = [
      { name: "A", category: "General" },
      { name: "B", category: "Snacks" },
    ];
    const next = applySharedCategoryToRows(rows, "DELL", new Set([0]));
    expect(next[0]?.category).toBe("DELL");
    expect(next[1]?.category).toBe("Snacks");
  });
});

describe("rename and delete-empty adapters", () => {
  it("remaps overlay identity after a shelf rename without inventing a second truth", () => {
    const nodes = [node({ id: "n1", legacyShelfKey: "DELL", name: "DELL" })];
    const next = remapCatalogNodesForRename(nodes, "DELL", "DELL LAPTOPS");
    expect(next[0]?.legacyShelfKey).toBe("DELL LAPTOPS");
    expect(next[0]?.name).toBe("DELL LAPTOPS");
  });

  it("retires a leaf overlay node when Delete Empty Shelf removes that identity", () => {
    const nodes = [
      node({ id: "n-el", legacyShelfKey: "ELECTRONICS" }),
      node({ id: "n-dell", parentId: "n-el", legacyShelfKey: "DELL" }),
    ];
    const next = retireCatalogNodesForDeletedShelf(nodes, "DELL");
    expect(next.map((n) => n.id)).toEqual(["n-el"]);
  });
});

describe("shop id helper", () => {
  it("uses local when wakaShopId is missing", () => {
    expect(catalogShopIdFromPreferences({})).toBe(LOCAL_CATALOG_SHOP_ID);
    expect(catalogShopIdFromPreferences({ wakaShopId: "A001" })).toBe("A001");
  });
});

describe("legacy discovery is independent of overlay rows", () => {
  it("collectShelfCategoryKeys ignores CatalogNode until layout/products/order mention the key", () => {
    const products = [product("DELL"), product("HP"), product("LENOVO")];
    const layout = { Accessories: { color: "green" as const } };
    const order = ["DELL", "HP"];
    const without = collectShelfCategoryKeys(products, order, layout);
    const withNodes = collectShelfCategoryKeys(products, order, layout);
    expect(withNodes).toEqual(without);
    expect(without).toEqual(expect.arrayContaining(["DELL", "HP", "LENOVO", "Accessories"]));
  });
});

describe("catalog section matching for import", () => {
  const sodaA: CatalogPickerItem = {
    id: "a",
    parentId: "drinks",
    name: "Soda",
    legacyShelfKey: "SODA-COLD",
    depth: 1,
    pathLabels: ["Drinks", "Soda"],
    persisted: true,
    sortOrder: 0,
  };
  const sodaB = {
    id: "b",
    parentId: "snacks",
    name: "Soda",
    legacyShelfKey: "SODA-SNACKS",
    depth: 1,
    pathLabels: ["Snacks", "Soda"],
    persisted: true,
    sortOrder: 1,
  };

  it("resolves a unique legacy key", () => {
    const r = resolveCatalogSectionInput([sodaA, sodaB], "SODA-COLD");
    expect(r.status).toBe("resolved");
    expect(r.category).toBe("SODA-COLD");
  });

  it("marks the same leaf name in two folders as ambiguous", () => {
    const r = resolveCatalogSectionInput([sodaA, sodaB], "Soda");
    expect(r.status).toBe("ambiguous");
    expect(r.category).toBe("");
    expect(catalogPickerItemsMatchingSection([sodaA, sodaB], "Soda")).toHaveLength(2);
  });

  it("resolves a unique path", () => {
    const r = resolveCatalogSectionInput([sodaA, sodaB], "Drinks / Soda");
    expect(r.status).toBe("resolved");
    expect(r.category).toBe("SODA-COLD");
  });
});
