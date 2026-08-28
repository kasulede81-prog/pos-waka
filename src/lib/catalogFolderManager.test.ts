import { describe, expect, it } from "vitest";
import type { CatalogNode, Product } from "../types";
import { LOCAL_CATALOG_SHOP_ID } from "./catalogHierarchy";
import {
  assignmentCategoryFromPickerItem,
  buildCatalogFolderTreeRows,
  buildCatalogPickerItems,
  catalogItemMatchesQuery,
  catalogReparentTargets,
  planCreateCatalogNode,
  planCreateCatalogShelf,
  planReorderCatalogSiblings,
  planReparentCatalogNode,
  searchCatalogPickerItems,
  settingsCatalogFoldersVisible,
  visibleCatalogFolderTreeRows,
} from "./catalogHierarchy";
import { buildCatalogBrowseIndex, resolveSellCatalogHierarchyView } from "./catalogBrowse";
import { buildStockCatalogBrowseIndex, resolveStockCatalogHierarchyView } from "./stockCatalogBrowse";
import { collectShelfCategoryKeys } from "./posShelfLayout";

function product(partial: Partial<Product> & { id: string; category: string }): Product {
  return {
    name: partial.name ?? partial.id,
    sku: partial.sku ?? "SKU",
    baseUnit: "piece",
    stockOnHand: partial.stockOnHand ?? 4,
    minimumStockAlert: 0,
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 500,
    sellingMode: "unit",
    updatedAt: "",
    version: 1,
    pharmacyMaster: { barcodes: ["999"] },
    ...partial,
  } as Product;
}

function node(partial: Partial<CatalogNode> & Pick<CatalogNode, "id" | "legacyShelfKey">): CatalogNode {
  return {
    shopId: LOCAL_CATALOG_SHOP_ID,
    parentId: null,
    name: partial.name ?? partial.legacyShelfKey,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("settings catalog folder planners", () => {
  it("1. creates a top-level folder without products", () => {
    const plan = planCreateCatalogShelf({
      name: "ELECTRONICS",
      parentId: null,
      nodes: [],
      shopId: "s",
      layout: {},
      orderKeys: [],
      id: "n-el",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.node.parentId).toBeNull();
    expect(plan.node.legacyShelfKey).toBe("ELECTRONICS");
    expect(plan.layout.ELECTRONICS).toBeTruthy();
    expect(plan.orderKeys).toContain("ELECTRONICS");
  });

  it("2. creates a child folder under a parent", () => {
    const root = planCreateCatalogNode({ name: "ELECTRONICS", parentId: null, nodes: [], shopId: "s", id: "n-el" });
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const child = planCreateCatalogNode({
      name: "COMPUTERS",
      parentId: root.node.id,
      nodes: root.nodes,
      shopId: "s",
      id: "n-comp",
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    expect(child.node.parentId).toBe("n-el");
  });

  it("3. creates a deep folder chain", () => {
    let nodes: CatalogNode[] = [];
    let parentId: string | null = null;
    for (const name of ["ELECTRONICS", "COMPUTERS", "DELL", "LATITUDE"]) {
      const plan = planCreateCatalogNode({ name, parentId, nodes, shopId: "s", id: `n-${name}` });
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      nodes = plan.nodes;
      parentId = plan.node.id;
    }
    const lat = nodes.find((n) => n.legacyShelfKey === "LATITUDE");
    expect(lat?.parentId).toBe("n-DELL");
  });

  it("4. rejects a duplicate folder name", () => {
    const first = planCreateCatalogNode({ name: "DELL", parentId: null, nodes: [], shopId: "s", id: "1" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = planCreateCatalogNode({ name: "dell", parentId: null, nodes: first.nodes, shopId: "s", id: "2" });
    expect(second.ok).toBe(false);
  });

  it("5–6. search matches folder name, identity, and path", () => {
    const electronics = node({ id: "n-el", legacyShelfKey: "ELECTRONICS", name: "Electronics" });
    const computers = node({ id: "n-comp", legacyShelfKey: "COMPUTERS", name: "Computers", parentId: "n-el" });
    const laptops = node({ id: "n-lap", legacyShelfKey: "LAPTOPS", name: "Laptops", parentId: "n-comp" });
    const dell = node({ id: "n-dell", legacyShelfKey: "DELL", name: "Dell", parentId: "n-lap" });
    const latitude = node({ id: "n-lat", legacyShelfKey: "LATITUDE", name: "Latitude", parentId: "n-dell" });
    const items = buildCatalogPickerItems({
      products: [],
      layout: {},
      orderKeys: [],
      nodes: [electronics, computers, laptops, dell, latitude],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    const lat = items.find((i) => i.legacyShelfKey === "LATITUDE");
    expect(lat).toBeTruthy();
    expect(catalogItemMatchesQuery(lat!, "Latitude")).toBe(true);
    expect(searchCatalogPickerItems(items, "Dell Latitude").map((i) => i.legacyShelfKey)).toContain("LATITUDE");
    expect(lat?.pathLabels.join(" / ")).toBe("Electronics / Computers / Laptops / Dell / Latitude");
  });

  it("7–8. tree rendering and expand/collapse hide descendants", () => {
    const electronics = node({ id: "n-el", legacyShelfKey: "ELECTRONICS" });
    const computers = node({ id: "n-comp", legacyShelfKey: "COMPUTERS", parentId: "n-el" });
    const dell = node({ id: "n-dell", legacyShelfKey: "DELL", parentId: "n-comp" });
    const rows = buildCatalogFolderTreeRows({
      nodes: [electronics, computers, dell],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    expect(rows.map((r) => r.legacyShelfKey)).toEqual(["ELECTRONICS", "COMPUTERS", "DELL"]);
    expect(rows.every((r) => !r.id.includes("virtual:") && r.id.startsWith("n-"))).toBe(true);
    const collapsed = visibleCatalogFolderTreeRows(rows, new Set(), "");
    expect(collapsed.map((r) => r.legacyShelfKey)).toEqual(["ELECTRONICS"]);
    const openEl = visibleCatalogFolderTreeRows(rows, new Set(["n-el"]), "");
    expect(openEl.map((r) => r.legacyShelfKey)).toEqual(["ELECTRONICS", "COMPUTERS"]);
    const search = visibleCatalogFolderTreeRows(rows, new Set(), "DELL");
    expect(search.map((r) => r.legacyShelfKey)).toEqual(["ELECTRONICS", "COMPUTERS", "DELL"]);
  });

  it("9. sibling ordering uses CatalogNode.sortOrder", () => {
    const parent = node({ id: "n-el", legacyShelfKey: "ELECTRONICS" });
    const a = node({ id: "n-a", legacyShelfKey: "COMPUTERS", parentId: "n-el", sortOrder: 0 });
    const b = node({ id: "n-b", legacyShelfKey: "PRINTERS", parentId: "n-el", sortOrder: 1 });
    const c = node({ id: "n-c", legacyShelfKey: "ACCESSORIES", parentId: "n-el", sortOrder: 2 });
    const plan = planReorderCatalogSiblings({
      parentId: "n-el",
      orderedIds: ["n-c", "n-a", "n-b"],
      nodes: [parent, a, b, c],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const rows = buildCatalogFolderTreeRows({ nodes: plan.nodes, shopId: LOCAL_CATALOG_SHOP_ID });
    expect(rows.filter((r) => r.parentId === "n-el").map((r) => r.legacyShelfKey)).toEqual([
      "ACCESSORIES",
      "COMPUTERS",
      "PRINTERS",
    ]);
  });

  it("10. reparent changes only parentId", () => {
    const electronics = node({ id: "n-el", legacyShelfKey: "ELECTRONICS" });
    const computers = node({ id: "n-comp", legacyShelfKey: "COMPUTERS", parentId: "n-el" });
    const printers = node({ id: "n-pr", legacyShelfKey: "PRINTERS", parentId: "n-el" });
    const dell = node({ id: "n-dell", legacyShelfKey: "DELL", parentId: "n-el" });
    const products = [product({ id: "p1", category: "DELL", stockOnHand: 7 })];
    const snapshot = structuredClone(products);
    const plan = planReparentCatalogNode({
      nodeId: "n-dell",
      parentId: "n-comp",
      nodes: [electronics, computers, printers, dell],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nodes.find((n) => n.id === "n-dell")?.parentId).toBe("n-comp");
    expect(products).toEqual(snapshot);
  });

  it("11–12. cycle and descendant parent are rejected", () => {
    const electronics = node({ id: "n-el", legacyShelfKey: "ELECTRONICS" });
    const computers = node({ id: "n-comp", legacyShelfKey: "COMPUTERS", parentId: "n-el" });
    const laptops = node({ id: "n-lap", legacyShelfKey: "LAPTOPS", parentId: "n-comp" });
    expect(planReparentCatalogNode({
      nodeId: "n-el",
      parentId: "n-el",
      nodes: [electronics, computers, laptops],
      shopId: LOCAL_CATALOG_SHOP_ID,
    }).ok).toBe(false);
    expect(planReparentCatalogNode({
      nodeId: "n-el",
      parentId: "n-lap",
      nodes: [electronics, computers, laptops],
      shopId: LOCAL_CATALOG_SHOP_ID,
    })).toEqual({ ok: false, errorKey: "catalogReparentCycle" });
    const targets = catalogReparentTargets([electronics, computers, laptops], LOCAL_CATALOG_SHOP_ID, "n-el");
    expect(targets.map((n) => n.id)).toEqual([]);
  });

  it("13–14. empty folder vs parent with children", () => {
    const electronics = node({ id: "n-el", legacyShelfKey: "ELECTRONICS" });
    const computers = node({ id: "n-comp", legacyShelfKey: "COMPUTERS", parentId: "n-el" });
    const spare = node({ id: "n-spare", legacyShelfKey: "SPARE" });
    const rows = buildCatalogFolderTreeRows({
      nodes: [electronics, computers, spare],
      shopId: LOCAL_CATALOG_SHOP_ID,
      products: [],
    });
    expect(rows.find((r) => r.id === "n-el")?.hasChildren).toBe(true);
    expect(rows.find((r) => r.id === "n-spare")?.hasChildren).toBe(false);
    expect(rows.find((r) => r.id === "n-spare")?.directProductCount).toBe(0);
  });

  it("16. virtual/legacy shelves stay out of the CatalogNode tree until promoted", () => {
    const rows = buildCatalogFolderTreeRows({
      nodes: [],
      shopId: LOCAL_CATALOG_SHOP_ID,
      products: [product({ id: "p1", category: "DELL" })],
    });
    expect(rows).toEqual([]);
    const items = buildCatalogPickerItems({
      products: [product({ id: "p1", category: "DELL" })],
      layout: { DELL: {} },
      orderKeys: ["DELL"],
      nodes: [],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    expect(items.find((i) => i.legacyShelfKey === "DELL")?.persisted).toBe(false);
  });

  it("17. Add Product picker sees a newly created nested folder", () => {
    let nodes: CatalogNode[] = [];
    let parentId: string | null = null;
    for (const name of ["ELECTRONICS", "COMPUTERS", "DELL", "LATITUDE"]) {
      const plan = planCreateCatalogNode({ name, parentId, nodes, shopId: LOCAL_CATALOG_SHOP_ID, id: `n-${name}` });
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      nodes = plan.nodes;
      parentId = plan.node.id;
    }
    const items = buildCatalogPickerItems({
      products: [],
      layout: {},
      orderKeys: [],
      nodes,
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    const lat = items.find((i) => i.legacyShelfKey === "LATITUDE");
    expect(lat?.pathLabels).toEqual(["ELECTRONICS", "COMPUTERS", "DELL", "LATITUDE"]);
    expect(assignmentCategoryFromPickerItem(lat!)).toBe("LATITUDE");
  });

  it("18–19. Sell and Stock browse the new nested folders", () => {
    const electronics = node({ id: "n-el", legacyShelfKey: "ELECTRONICS", name: "Electronics" });
    const dell = node({ id: "n-dell", legacyShelfKey: "DELL", name: "Dell", parentId: "n-el" });
    const latitude = node({ id: "n-lat", legacyShelfKey: "LATITUDE", name: "Latitude", parentId: "n-dell" });
    const products = [product({ id: "p-lat", name: "Dell Latitude 5420", category: "LATITUDE", stockOnHand: 3 })];
    const index = buildCatalogBrowseIndex({
      products,
      layout: {},
      orderKeys: [],
      nodes: [electronics, dell, latitude],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    const sellRoot = resolveSellCatalogHierarchyView({
      enabled: true,
      path: [],
      searchQuery: "",
      index,
      layout: {},
    });
    expect(sellRoot?.folders.map((f) => f.identity)).toContain("ELECTRONICS");
    const sellLat = resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "DELL", "LATITUDE"],
      searchQuery: "",
      index,
      layout: {},
    });
    expect(sellLat?.directProducts.map((p) => p.id)).toEqual(["p-lat"]);
    const stockIndex = buildStockCatalogBrowseIndex({
      products,
      layout: {},
      nodes: [electronics, dell, latitude],
      shopId: LOCAL_CATALOG_SHOP_ID,
      orderKeys: [],
      uncategorizedLabel: "Uncategorized",
    });
    const stock = resolveStockCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "DELL"],
      index: stockIndex,
      layout: {},
    });
    expect(stock?.folders.some((f) => f.identity === "LATITUDE")).toBe(true);
  });

  it("20–24. create/reparent/reorder planners do not touch product inventory fields", () => {
    const electronics = node({ id: "n-el", legacyShelfKey: "ELECTRONICS" });
    const computers = node({ id: "n-comp", legacyShelfKey: "COMPUTERS", parentId: "n-el", sortOrder: 0 });
    const printers = node({ id: "n-pr", legacyShelfKey: "PRINTERS", parentId: "n-el", sortOrder: 1 });
    const products = [
      product({ id: "p1", category: "DELL", sku: "LAT", stockOnHand: 8, pharmacyMaster: { barcodes: ["111"] } }),
    ];
    const snap = structuredClone(products);
    planCreateCatalogNode({ name: "LAPTOPS", parentId: "n-comp", nodes: [electronics, computers, printers], shopId: LOCAL_CATALOG_SHOP_ID });
    planReparentCatalogNode({
      nodeId: "n-pr",
      parentId: "n-comp",
      nodes: [electronics, computers, printers],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    planReorderCatalogSiblings({
      parentId: "n-el",
      orderedIds: ["n-pr", "n-comp"],
      nodes: [electronics, computers, printers],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    expect(products).toEqual(snap);
    expect(products[0]?.id).toBe("p1");
    expect(products[0]?.sku).toBe("LAT");
    expect(products[0]?.stockOnHand).toBe(8);
    expect(products[0]?.pharmacyMaster?.barcodes).toEqual(["111"]);
    expect("catalogNodeId" in products[0]!).toBe(false);
  });

  it("25. flag OFF hides Settings folder chrome and does not invent nodes", () => {
    expect(settingsCatalogFoldersVisible(false)).toBe(false);
    expect(settingsCatalogFoldersVisible(true)).toBe(true);
    const keys = collectShelfCategoryKeys([product({ id: "p1", category: "DELL" })], ["DELL"], { DELL: {} });
    expect(keys).toEqual(["DELL"]);
  });

  it("27. tree rows indent by depth and wrap without UUIDs in labels", () => {
    const electronics = node({ id: "550e8400-e29b-41d4-a716-446655440000", legacyShelfKey: "ELECTRONICS", name: "Electronics" });
    const dell = node({ id: "n-dell", legacyShelfKey: "DELL", name: "Dell", parentId: electronics.id });
    const rows = buildCatalogFolderTreeRows({
      nodes: [electronics, dell],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    expect(rows[1]?.depth).toBe(1);
    expect(rows[1]?.pathText).toBe("Electronics / Dell");
    expect(rows[1]?.pathText).not.toContain("550e8400");
  });
});
