import { describe, expect, it } from "vitest";
import type { CatalogNode, Product } from "../types";
import { UNCATEGORIZED_SENTINEL } from "./productCategories";
import { QUICK_SELL_SHELF_KEY } from "./posShelfLayout";
import { LOCAL_CATALOG_SHOP_ID, VIRTUAL_NODE_PREFIX } from "./catalogHierarchy";
import { PHARMACY_CATEGORY_PRESETS } from "./pharmacy";
import { defaultMenuCategoriesForBusinessType } from "./hospitality";
import {
  catalogIdentityHasChildFolders,
  filterProductsForEmptyShelfRefill,
  listEmptyShelfRows,
  planRefillEmptyShelf,
} from "./emptyShelfManager";
import { planBulkDeleteEmptyShelves, bulkDeleteEmptyShelvesPreferencePatch } from "./planBulkDeleteEmptyShelves";
import { planDeleteEmptyShelf } from "./deleteEmptyShelf";

function product(partial: Partial<Product> & { id: string; category: string }): Product {
  return {
    name: partial.name ?? partial.id,
    sku: partial.sku ?? "",
    baseUnit: "piece",
    stockOnHand: partial.stockOnHand ?? 1,
    minimumStockAlert: 0,
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 500,
    sellingMode: "unit",
    updatedAt: "",
    version: 1,
    ...partial,
  } as Product;
}

function node(input: {
  id: string;
  legacyShelfKey: string;
  name?: string;
  parentId?: string | null;
}): CatalogNode {
  return {
    id: input.id,
    shopId: LOCAL_CATALOG_SHOP_ID,
    parentId: input.parentId ?? null,
    legacyShelfKey: input.legacyShelfKey,
    name: input.name ?? input.legacyShelfKey,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  };
}

describe("listEmptyShelfRows — discovery", () => {
  it("lists empty layout shelves and omits occupied identities", () => {
    const rows = listEmptyShelfRows({
      products: [product({ id: "p1", category: "DELL LAPTOPS" })],
      layout: { DELL: { color: "blue" }, HP: { color: "orange" }, "DELL LAPTOPS": {} },
      orderKeys: ["DELL", "HP", "DELL LAPTOPS"],
    });
    expect(rows.map((r) => r.key)).toEqual(["DELL", "HP"]);
    expect(rows.every((r) => r.productCount === 0 && r.deletable)).toBe(true);
  });

  it("37. hierarchy OFF ignores CatalogNode-only folders", () => {
    const rows = listEmptyShelfRows({
      products: [],
      layout: { DELL: {} },
      orderKeys: ["DELL"],
      nodes: [node({ id: "n-el", legacyShelfKey: "ELECTRONICS" })],
      hierarchyEnabled: false,
    });
    expect(rows.map((r) => r.key)).toEqual(["DELL"]);
    expect(rows.some((r) => r.pathText.includes("ELECTRONICS"))).toBe(false);
  });

  it("38. hierarchy ON includes empty CatalogNode leaves and paths", () => {
    const electronics = node({ id: "n-el", legacyShelfKey: "ELECTRONICS", name: "Electronics" });
    const computers = node({
      id: "n-comp",
      legacyShelfKey: "COMPUTERS",
      name: "Computers",
      parentId: electronics.id,
    });
    const laptops = node({
      id: "n-lap",
      legacyShelfKey: "LAPTOPS",
      name: "Laptops",
      parentId: computers.id,
    });
    const dell = node({ id: "n-dell", legacyShelfKey: "DELL", name: "Dell", parentId: laptops.id });
    const rows = listEmptyShelfRows({
      products: [],
      layout: { DELL: {} },
      orderKeys: ["DELL"],
      nodes: [electronics, computers, laptops, dell],
      hierarchyEnabled: true,
    });
    const dellRow = rows.find((r) => r.key === "DELL");
    expect(dellRow?.pathText).toBe("Electronics / Computers / Laptops / Dell");
    expect(dellRow?.deletable).toBe(true);
    const parent = rows.find((r) => r.key === "ELECTRONICS");
    expect(parent?.hasChildFolders).toBe(true);
    expect(parent?.deletable).toBe(false);
  });

  it("does not list reserved, virtual, or UUID folder ids", () => {
    const rows = listEmptyShelfRows({
      products: [],
      layout: {
        [QUICK_SELL_SHELF_KEY]: {},
        [UNCATEGORIZED_SENTINEL]: {},
        [`${VIRTUAL_NODE_PREFIX}ghost`]: {},
        ACCESSORIES: {},
      },
      orderKeys: [QUICK_SELL_SHELF_KEY, UNCATEGORIZED_SENTINEL, "ACCESSORIES"],
      nodes: [node({ id: "550e8400-e29b-41d4-a716-446655440000", legacyShelfKey: "ACCESSORIES" })],
      hierarchyEnabled: true,
    });
    expect(rows.map((r) => r.key)).toEqual(["ACCESSORIES"]);
    expect(rows[0]?.pathText).not.toContain("550e8400");
    expect(rows[0]?.pathText).not.toContain("virtual:");
  });

  it("9. pharmacy preset identities are not deletable", () => {
    const rows = listEmptyShelfRows({
      products: [],
      layout: { Antibiotics: {}, DELL: {} },
      orderKeys: ["Antibiotics", "DELL"],
      pharmacyMode: true,
      businessType: "pharmacy",
    });
    expect(rows.find((r) => r.key === "Antibiotics")?.deletable).toBe(false);
    expect(rows.find((r) => r.key === "Antibiotics")?.presetProtected).toBe(true);
    expect(rows.find((r) => r.key === "DELL")?.deletable).toBe(true);
  });

  it("does not invent a pharmacy preset that was never persisted", () => {
    const rows = listEmptyShelfRows({
      products: [],
      layout: { DELL: {} },
      orderKeys: ["DELL"],
      pharmacyMode: true,
      businessType: "pharmacy",
    });
    expect(rows.some((r) => r.key === "Antibiotics")).toBe(false);
  });

  it("10. hospitality preset identities are not deletable", () => {
    const rows = listEmptyShelfRows({
      products: [],
      layout: { Food: {}, DELL: {} },
      orderKeys: ["Food", "DELL"],
      hospitalityMode: true,
      businessType: "restaurant",
    });
    expect(rows.find((r) => r.key === "Food")?.deletable).toBe(false);
    expect(rows.find((r) => r.key === "DELL")?.deletable).toBe(true);
  });
});

describe("planBulkDeleteEmptyShelves", () => {
  const layout = {
    DELL: { color: "blue" as const },
    HP: { color: "orange" as const },
    Accessories: { color: "green" as const },
  };

  it("1. deletes an empty single shelf", () => {
    const products = [product({ id: "a", category: "HP" })];
    const snapshot = products.map((p) => ({ ...p }));
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL"],
      products,
      layout,
      orderKeys: ["DELL", "HP", "Accessories"],
    });
    expect(result.deletedKeys).toEqual(["DELL"]);
    expect(result.layout.DELL).toBeUndefined();
    expect(result.layout.HP).toEqual({ color: "orange" });
    expect(result.orderKeys).toEqual(["HP", "Accessories"]);
    expect(products).toEqual(snapshot);
  });

  it("2. deletes multiple empty shelves", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL", "Accessories"],
      products: [product({ id: "a", category: "HP" })],
      layout,
      orderKeys: ["DELL", "HP", "Accessories"],
    });
    expect(result.deletedKeys).toEqual(["DELL", "Accessories"]);
    expect(result.layout.DELL).toBeUndefined();
    expect(result.layout.Accessories).toBeUndefined();
    expect(result.layout.HP).toEqual({ color: "orange" });
    expect(result.orderKeys).toEqual(["HP"]);
  });

  it("3. selected non-empty shelf is rejected", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL", "HP"],
      products: [product({ id: "a", category: "DELL" })],
      layout,
      orderKeys: ["DELL", "HP", "Accessories"],
    });
    expect(result.deletedKeys).toEqual(["HP"]);
    expect(result.skipped).toEqual([{ key: "DELL", reason: "occupied" }]);
    expect(result.layout.DELL).toEqual({ color: "blue" });
  });

  it("4. archived product still in products blocks delete", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL"],
      products: [product({ id: "archived-1", category: "DELL" })],
      layout: { DELL: {} },
      orderKeys: ["DELL"],
    });
    expect(result.deletedKeys).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("occupied");
  });

  it("5. empty case variants are removed together", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL"],
      products: [product({ id: "a", category: "HP" })],
      layout: { DELL: { color: "blue" }, Dell: { icon: "💻" }, dell: { color: "red" }, HP: {} },
      orderKeys: ["dell", "HP", "DELL", "Dell"],
      sellCategoryFilter: "Dell",
    });
    expect(result.deletedKeys).toEqual(["DELL"]);
    expect(result.layout.DELL).toBeUndefined();
    expect(result.layout.Dell).toBeUndefined();
    expect(result.layout.dell).toBeUndefined();
    expect(result.orderKeys).toEqual(["HP"]);
    expect(result.clearSellCategoryFilter).toBe(true);
  });

  it("6. occupied case variant blocks deletion", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL"],
      products: [product({ id: "a", category: "Dell" })],
      layout: { DELL: {}, Dell: {} },
      orderKeys: ["DELL", "Dell"],
    });
    expect(result.deletedKeys).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("occupied");
  });

  it("7. parent with children cannot delete", () => {
    const electronics = node({ id: "n-el", legacyShelfKey: "ELECTRONICS" });
    const computers = node({ id: "n-comp", legacyShelfKey: "COMPUTERS", parentId: electronics.id });
    expect(catalogIdentityHasChildFolders([electronics, computers], LOCAL_CATALOG_SHOP_ID, "ELECTRONICS")).toBe(true);
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["ELECTRONICS"],
      products: [],
      layout: { ELECTRONICS: {}, COMPUTERS: {} },
      orderKeys: ["ELECTRONICS", "COMPUTERS"],
      nodes: [electronics, computers],
      hierarchyEnabled: true,
    });
    expect(result.deletedKeys).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("hasChildren");
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["n-comp", "n-el"]);
  });

  it("8. leaf CatalogNode can delete", () => {
    const spare = node({ id: "n-spare", legacyShelfKey: "SPARE" });
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["SPARE"],
      products: [],
      layout: { SPARE: {}, HP: {} },
      orderKeys: ["SPARE", "HP"],
      nodes: [spare],
      hierarchyEnabled: true,
    });
    expect(result.deletedKeys).toEqual(["SPARE"]);
    expect(result.nodes).toEqual([]);
    expect(result.layout.SPARE).toBeUndefined();
  });

  it("9. pharmacy preset is protected", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["Antibiotics"],
      products: [],
      layout: { Antibiotics: {} },
      orderKeys: ["Antibiotics"],
      pharmacyMode: true,
      businessType: "pharmacy",
    });
    expect(result.deletedKeys).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("preset");
    expect(result.layout.Antibiotics).toEqual({});
  });

  it("10. hospitality preset is protected", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["Beer"],
      products: [],
      layout: { Beer: {} },
      orderKeys: ["Beer"],
      hospitalityMode: true,
      businessType: "bar",
    });
    expect(result.deletedKeys).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("preset");
  });

  it("11. reserved Uncategorized is protected", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: [UNCATEGORIZED_SENTINEL],
      products: [],
      layout: {},
      orderKeys: [],
    });
    expect(result.skipped[0]?.reason).toBe("reserved");
    expect(result.deletedKeys).toEqual([]);
  });

  it("12. Quick Sell is protected", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: [QUICK_SELL_SHELF_KEY],
      products: [],
      layout: {},
      orderKeys: [],
    });
    expect(result.skipped[0]?.reason).toBe("reserved");
  });

  it("13. sell filter is cleared when it matches a deleted identity", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL"],
      products: [],
      layout: { DELL: {}, HP: {} },
      orderKeys: ["DELL", "HP"],
      sellCategoryFilter: "dell",
    });
    expect(result.clearSellCategoryFilter).toBe(true);
  });

  it("14–15. layout and order of deleted shelves are removed", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL"],
      products: [],
      layout: { DELL: { color: "blue" }, HP: { color: "orange" } },
      orderKeys: ["DELL", "HP"],
    });
    expect(result.layout).toEqual({ HP: { color: "orange" } });
    expect(result.orderKeys).toEqual(["HP"]);
  });

  it("16. CatalogNode leaf is removed", () => {
    const leaf = node({ id: "n-old", legacyShelfKey: "OLD LAPTOPS", name: "Old Laptops" });
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["OLD LAPTOPS"],
      products: [],
      layout: { "OLD LAPTOPS": {} },
      orderKeys: ["OLD LAPTOPS"],
      nodes: [leaf],
      hierarchyEnabled: true,
    });
    expect(result.nodes).toEqual([]);
    expect(result.nodesChanged).toBe(true);
  });

  it("17. unrelated empty shelf survives", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL"],
      products: [],
      layout: { DELL: {}, SPARE: {} },
      orderKeys: ["DELL", "SPARE"],
    });
    expect(result.layout.SPARE).toEqual({});
    expect(result.orderKeys).toEqual(["SPARE"]);
  });

  it("18. stale occupied selection is re-checked", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL", "HP"],
      products: [product({ id: "late", category: "DELL" })],
      layout: { DELL: {}, HP: {} },
      orderKeys: ["DELL", "HP"],
    });
    expect(result.deletedKeys).toEqual(["HP"]);
    expect(result.skipped).toEqual([{ key: "DELL", reason: "occupied" }]);
  });

  it("19. bulk operation produces one merged preference patch", () => {
    const result = planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL", "Accessories"],
      products: [],
      layout,
      orderKeys: ["DELL", "HP", "Accessories"],
    });
    const patch = bulkDeleteEmptyShelvesPreferencePatch(result);
    expect(patch).toEqual({
      posShelfLayout: result.layout,
      posPinnedShelfKeys: result.orderKeys,
    });
    expect(Object.keys(patch ?? {})).toEqual(["posShelfLayout", "posPinnedShelfKeys"]);
  });

  it("20. products are unchanged by the planner", () => {
    const products = [product({ id: "a", category: "HP", sku: "HP-1", stockOnHand: 9 })];
    const snapshot = structuredClone(products);
    planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL"],
      products,
      layout,
      orderKeys: ["DELL", "HP"],
    });
    expect(products).toEqual(snapshot);
  });

  it("shares occupancy semantics with planDeleteEmptyShelf", () => {
    const products = [product({ id: "a", category: "Dell" })];
    const single = planDeleteEmptyShelf({
      shelfKey: "DELL",
      products,
      layout: { DELL: {} },
      orderKeys: ["DELL"],
    });
    const bulk = planBulkDeleteEmptyShelves({
      shelfKeys: ["DELL"],
      products,
      layout: { DELL: {} },
      orderKeys: ["DELL"],
    });
    expect(single.ok).toBe(false);
    expect(bulk.deletedKeys).toEqual([]);
    expect(bulk.skipped[0]?.reason).toBe("occupied");
  });
});

describe("refill planning and search", () => {
  const products = [
    product({
      id: "p1",
      name: "Dell Latitude 5420",
      category: "OLD LAPTOPS",
      sku: "LAT-5420",
      stockOnHand: 4,
      pharmacyMaster: { barcodes: ["111"] },
    }),
    product({
      id: "p2",
      name: "Dell Latitude 5430",
      category: "WAREHOUSE STOCK",
      sku: "LAT-5430",
      stockOnHand: 8,
    }),
    product({ id: "p3", name: "HP EliteBook", category: "HP", sku: "HP-1", stockOnHand: 2 }),
  ];

  it("21. search existing products by name, sku, and barcode", () => {
    expect(filterProductsForEmptyShelfRefill(products, "DELL", "latitude").map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(filterProductsForEmptyShelfRefill(products, "DELL", "LAT-5430").map((p) => p.id)).toEqual(["p2"]);
    expect(filterProductsForEmptyShelfRefill(products, "DELL", "111").map((p) => p.id)).toEqual(["p1"]);
  });

  it("excludes products already on the destination", () => {
    const already = [...products, product({ id: "p4", name: "On Dell", category: "DELL" })];
    expect(filterProductsForEmptyShelfRefill(already, "DELL", "").map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("22–24. move plan changes only destination identity", () => {
    const plan = planRefillEmptyShelf({ destinationKey: "DELL", productIds: ["p1"], products });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.destinationKey).toBe("DELL");
    expect(plan.moveIds).toEqual(["p1"]);
  });

  it("23. move multiple products", () => {
    const plan = planRefillEmptyShelf({ destinationKey: "DELL", productIds: ["p1", "p2"], products });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.moveIds).toEqual(["p1", "p2"]);
  });

  it("32. destination identity is the empty shelf key, not a UUID", () => {
    const plan = planRefillEmptyShelf({
      destinationKey: "DELL",
      productIds: ["p1"],
      products,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.destinationKey).toBe("DELL");
    expect(plan.destinationKey.startsWith(VIRTUAL_NODE_PREFIX)).toBe(false);
  });

  it("35. stale missing product ids are reported", () => {
    const plan = planRefillEmptyShelf({
      destinationKey: "DELL",
      productIds: ["p1", "gone"],
      products,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.moveIds).toEqual(["p1"]);
    expect(plan.skippedMissing).toEqual(["gone"]);
  });

  it("41. pharmacy and hospitality preset source arrays are unchanged", () => {
    expect(PHARMACY_CATEGORY_PRESETS).toContain("Antibiotics");
    expect(defaultMenuCategoriesForBusinessType("restaurant")).toContain("Food");
    expect(defaultMenuCategoriesForBusinessType("bar")).toContain("Beer");
  });
});
