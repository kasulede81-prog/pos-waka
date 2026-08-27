import { describe, expect, it } from "vitest";
import type { CatalogNode, Product } from "../types";
import {
  LOCAL_CATALOG_SHOP_ID,
  VIRTUAL_NODE_PREFIX,
  remapCatalogNodesForRename,
  retireCatalogNodesForDeletedShelf,
} from "./catalogHierarchy";
import { planDeleteEmptyShelf } from "./deleteEmptyShelf";
import { planShelfRename } from "./renameShelfCategory";
import {
  UNCATEGORIZED_SENTINEL,
  productMatchesCategoryFilter,
} from "./productCategories";
import {
  buildPosShelfDisplayCards,
  collectShelfCategoryKeys,
} from "./posShelfLayout";
import {
  buildCatalogBrowseIndex,
  catalogBrowseFoldersToShelfCards,
  catalogBrowsePathLabels,
  catalogBrowseProductMatchesIdentity,
  jumpCatalogBrowseToIdentity,
  popCatalogBrowseIdentity,
  pushCatalogBrowseIdentity,
  resolveCatalogBrowse,
  resolveCatalogBrowseLevel,
  resolveSellCatalogHierarchyView,
  sanitizeCatalogBrowsePath,
} from "./catalogBrowse";

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

describe("catalog browse resolver", () => {
  it("returns persisted CatalogNode roots", () => {
    const level = resolveCatalogBrowse(
      {
        products: [],
        layout: {},
        orderKeys: [],
        nodes: [
          node({ id: "n-el", legacyShelfKey: "ELECTRONICS", sortOrder: 0 }),
          node({ id: "n-fa", legacyShelfKey: "FASHION", sortOrder: 1 }),
        ],
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      null,
    );
    expect(level.found).toBe(true);
    expect(level.current).toBeNull();
    expect(level.directProducts).toEqual([]);
    expect(level.folders.map((f) => f.identity)).toEqual(["ELECTRONICS", "FASHION"]);
    expect(level.folders.every((f) => f.persisted)).toBe(true);
    expect(level.folders.some((f) => f.identity.startsWith(VIRTUAL_NODE_PREFIX))).toBe(false);
  });

  it("returns direct CatalogNode children", () => {
    const level = resolveCatalogBrowse(
      {
        products: [],
        layout: {},
        orderKeys: [],
        nodes: electronicsTree,
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "ELECTRONICS",
    );
    expect(level.folders.map((f) => f.identity)).toEqual(["COMPUTERS"]);
    expect(level.directProducts).toEqual([]);
  });

  it("resolves a three-level hierarchy", () => {
    const input = {
      products: [product({ id: "p-lat", name: "Latitude 5420", category: "LATITUDE" })],
      layout: {},
      orderKeys: [],
      nodes: electronicsTree,
      shopId: LOCAL_CATALOG_SHOP_ID,
    };
    expect(resolveCatalogBrowse(input, "ELECTRONICS").folders.map((f) => f.identity)).toEqual(["COMPUTERS"]);
    expect(resolveCatalogBrowse(input, "COMPUTERS").folders.map((f) => f.identity)).toEqual(["LAPTOPS"]);
    expect(resolveCatalogBrowse(input, "LAPTOPS").folders.map((f) => f.identity)).toEqual(["DELL"]);
  });

  it("resolves an arbitrary deeper hierarchy by identity, not UUID", () => {
    const nodes: CatalogNode[] = [
      node({ id: "uuid-hw", legacyShelfKey: "HARDWARE" }),
      node({ id: "uuid-el", parentId: "uuid-hw", legacyShelfKey: "ELECTRICAL" }),
      node({ id: "uuid-ca", parentId: "uuid-el", legacyShelfKey: "CABLES" }),
      node({ id: "uuid-cu", parentId: "uuid-ca", legacyShelfKey: "COPPER" }),
      node({ id: "uuid-mm", parentId: "uuid-cu", legacyShelfKey: "2.5MM" }),
      node({ id: "uuid-st", parentId: "uuid-mm", legacyShelfKey: "STRANDED" }),
    ];
    const level = resolveCatalogBrowse(
      {
        products: [product({ id: "p1", name: "Cable", category: "STRANDED" })],
        layout: {},
        orderKeys: [],
        nodes,
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "STRANDED",
    );
    expect(level.found).toBe(true);
    expect(level.path.map((e) => e.identity)).toEqual([
      "HARDWARE",
      "ELECTRICAL",
      "CABLES",
      "COPPER",
      "2.5MM",
      "STRANDED",
    ]);
    expect(level.path.some((e) => e.identity.startsWith("uuid-") || e.label.startsWith("uuid-"))).toBe(false);
    expect(level.directProducts.map((p) => p.id)).toEqual(["p1"]);
  });

  it("exposes unmatched legacy shelves as virtual roots using the existing shelf key", () => {
    const level = resolveCatalogBrowse(
      {
        products: [
          product({ id: "p-dell", name: "Latitude 5420", category: "DELL" }),
          product({ id: "p-hp", name: "EliteBook", category: "HP" }),
          product({ id: "p-lenovo", name: "ThinkPad", category: "LENOVO" }),
        ],
        layout: { HP: { displayName: "HP Laptops" } },
        orderKeys: ["DELL", "HP", "LENOVO"],
        nodes: [],
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      null,
    );
    expect(level.folders.map((f) => f.identity)).toEqual(["DELL", "HP", "LENOVO"]);
    expect(level.folders.every((f) => !f.persisted)).toBe(true);
    expect(level.folders.find((f) => f.identity === "HP")?.label).toBe("HP Laptops");
    expect(level.folders.some((f) => f.identity.includes("virtual:") || f.label.includes("virtual:"))).toBe(false);
  });

  it("mixes persisted roots with virtual unmatched shelves", () => {
    const level = resolveCatalogBrowse(
      {
        products: [
          product({ id: "p-dell", name: "Latitude", category: "DELL" }),
          product({ id: "p-acc", name: "Mouse", category: "ACCESSORIES" }),
        ],
        layout: { PRINTERS: { color: "blue" } },
        orderKeys: ["ACCESSORIES", "PRINTERS"],
        nodes: [node({ id: "n-el", legacyShelfKey: "ELECTRONICS" })],
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      null,
    );
    expect(level.folders.map((f) => f.identity)).toEqual(["ELECTRONICS", "ACCESSORIES", "PRINTERS", "DELL"]);
    expect(level.folders.find((f) => f.identity === "ELECTRONICS")?.persisted).toBe(true);
    expect(level.folders.find((f) => f.identity === "ACCESSORIES")?.persisted).toBe(false);
    expect(level.folders.find((f) => f.identity === "DELL")?.persisted).toBe(false);
  });

  it("supports a partial hierarchy without promoting nested identities to root", () => {
    const nodes = [
      node({ id: "n-el", legacyShelfKey: "ELECTRONICS" }),
      node({ id: "n-dell", parentId: "n-el", legacyShelfKey: "DELL", sortOrder: 0 }),
      node({ id: "n-hp", parentId: "n-el", legacyShelfKey: "HP", sortOrder: 1 }),
      node({ id: "n-lenovo", parentId: "n-el", legacyShelfKey: "LENOVO", sortOrder: 2 }),
    ];
    const input = {
      products: [
        product({ id: "p-dell", name: "Dell", category: "DELL" }),
        product({ id: "p-acc", name: "Bag", category: "ACCESSORIES" }),
      ],
      layout: { PRINTERS: { color: "green" as const } },
      orderKeys: ["ACCESSORIES", "PRINTERS"],
      nodes,
      shopId: LOCAL_CATALOG_SHOP_ID,
    };
    expect(resolveCatalogBrowse(input, null).folders.map((f) => f.identity)).toEqual([
      "ELECTRONICS",
      "ACCESSORIES",
      "PRINTERS",
    ]);
    expect(resolveCatalogBrowse(input, "ELECTRONICS").folders.map((f) => f.identity)).toEqual([
      "DELL",
      "HP",
      "LENOVO",
    ]);
  });

  it("returns only direct products for the current identity", () => {
    const input = {
      products: [
        product({ id: "p-laptop-a", name: "Dell Laptop A", category: "DELL" }),
        product({ id: "p-5420", name: "Latitude 5420", category: "LATITUDE" }),
        product({ id: "p-xps", name: "XPS 13", category: "XPS" }),
      ],
      layout: {},
      orderKeys: [],
      nodes: electronicsTree,
      shopId: LOCAL_CATALOG_SHOP_ID,
    };
    const dell = resolveCatalogBrowse(input, "DELL");
    expect(dell.directProducts.map((p) => p.id)).toEqual(["p-laptop-a"]);
    expect(dell.folders.map((f) => f.identity)).toEqual(["LATITUDE", "XPS"]);
  });

  it("supports mixed direct products and child folders on the same node", () => {
    const dell = resolveCatalogBrowse(
      {
        products: [
          product({ id: "p-laptop-a", name: "Dell Laptop A", category: "DELL" }),
          product({ id: "p-5420", name: "Latitude 5420", category: "LATITUDE" }),
        ],
        layout: {},
        orderKeys: [],
        nodes: electronicsTree,
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "DELL",
    );
    expect(dell.folders.map((f) => f.identity)).toEqual(["LATITUDE", "XPS"]);
    expect(dell.directProducts.map((p) => p.name)).toEqual(["Dell Laptop A"]);
  });

  it("does not dump descendant products into a parent level", () => {
    const electronics = resolveCatalogBrowse(
      {
        products: [
          product({ id: "p-laptop-a", name: "Dell Laptop A", category: "DELL" }),
          product({ id: "p-5420", name: "Latitude 5420", category: "LATITUDE" }),
          product({ id: "p-xps", name: "XPS 13", category: "XPS" }),
        ],
        layout: {},
        orderKeys: [],
        nodes: electronicsTree,
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "ELECTRONICS",
    );
    expect(electronics.directProducts).toEqual([]);
    expect(electronics.folders.map((f) => f.identity)).toEqual(["COMPUTERS"]);
  });

  it("reports inclusive descendant product counts on folders but not in directProducts", () => {
    const products = [
      product({ id: "p-dell", name: "Dell Laptop A", category: "DELL" }),
      ...Array.from({ length: 20 }, (_, i) =>
        product({ id: `p-lat-${i}`, name: `Latitude ${i}`, category: "LATITUDE" }),
      ),
      ...Array.from({ length: 30 }, (_, i) => product({ id: `p-xps-${i}`, name: `XPS ${i}`, category: "XPS" })),
    ];
    const laptops = resolveCatalogBrowse(
      {
        products,
        layout: {},
        orderKeys: [],
        nodes: electronicsTree,
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "LAPTOPS",
    );
    expect(laptops.folders.find((f) => f.identity === "DELL")?.inclusiveProductCount).toBe(51);
    const dell = resolveCatalogBrowse(
      {
        products,
        layout: {},
        orderKeys: [],
        nodes: electronicsTree,
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "DELL",
    );
    expect(dell.directProducts).toHaveLength(1);
    expect(dell.folders.find((f) => f.identity === "LATITUDE")?.inclusiveProductCount).toBe(20);
    expect(dell.folders.find((f) => f.identity === "XPS")?.inclusiveProductCount).toBe(30);
    expect(dell.directProducts).toHaveLength(1);
  });

  it("keeps empty folders visible when the node or layout identity exists", () => {
    const computers = resolveCatalogBrowse(
      {
        products: [],
        layout: {},
        orderKeys: [],
        nodes: [
          node({ id: "n-el", legacyShelfKey: "ELECTRONICS" }),
          node({ id: "n-comp", parentId: "n-el", legacyShelfKey: "COMPUTERS" }),
          node({ id: "n-dell", parentId: "n-comp", legacyShelfKey: "DELL" }),
        ],
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "COMPUTERS",
    );
    expect(computers.folders.map((f) => f.identity)).toEqual(["DELL"]);
    expect(computers.folders[0]?.inclusiveProductCount).toBe(0);
    expect(computers.directProducts).toEqual([]);

    const emptyLayoutRoot = resolveCatalogBrowse(
      {
        products: [],
        layout: { SPARE: { color: "orange" } },
        orderKeys: ["SPARE"],
        nodes: [],
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      null,
    );
    expect(emptyLayoutRoot.folders.map((f) => f.identity)).toEqual(["SPARE"]);
    expect(emptyLayoutRoot.folders[0]?.inclusiveProductCount).toBe(0);
  });

  it("orders persisted children by CatalogNode.sortOrder", () => {
    const level = resolveCatalogBrowse(
      {
        products: [],
        layout: {},
        orderKeys: [],
        nodes: [
          node({ id: "n-el", legacyShelfKey: "ELECTRONICS" }),
          node({ id: "n-c", parentId: "n-el", legacyShelfKey: "C", name: "C", sortOrder: 2 }),
          node({ id: "n-a", parentId: "n-el", legacyShelfKey: "A", name: "A", sortOrder: 0 }),
          node({ id: "n-b", parentId: "n-el", legacyShelfKey: "B", name: "B", sortOrder: 1 }),
        ],
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "ELECTRONICS",
    );
    expect(level.folders.map((f) => f.identity)).toEqual(["A", "B", "C"]);
  });

  it("orders virtual roots with the existing saved shelf order", () => {
    const level = resolveCatalogBrowse(
      {
        products: [
          product({ id: "p-z", name: "Zed", category: "ZEBRA" }),
          product({ id: "p-a", name: "Aye", category: "APPLE" }),
        ],
        layout: {},
        orderKeys: ["ZEBRA", "APPLE"],
        nodes: [],
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      null,
    );
    expect(level.folders.map((f) => f.identity)).toEqual(["ZEBRA", "APPLE"]);
  });

  it("resolves ancestor path labels without UUIDs", () => {
    const level = resolveCatalogBrowse(
      {
        products: [],
        layout: { ELECTRONICS: { displayName: "Electronics" } },
        orderKeys: [],
        nodes: electronicsTree,
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "LATITUDE",
    );
    expect(catalogBrowsePathLabels(level)).toEqual([
      "Electronics",
      "Computers",
      "Laptops",
      "Dell",
      "Latitude",
    ]);
    expect(level.ancestors.map((a) => a.identity)).toEqual(["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"]);
    expect(JSON.stringify(level.path)).not.toContain("n-");
  });

  it("isolates browse results by shop", () => {
    const nodes = [
      node({ id: "a-el", shopId: "shop-a", legacyShelfKey: "ELECTRONICS" }),
      node({ id: "b-food", shopId: "shop-b", legacyShelfKey: "FOOD" }),
    ];
    const a = resolveCatalogBrowse(
      { products: [], layout: {}, orderKeys: [], nodes, shopId: "shop-a" },
      null,
    );
    const b = resolveCatalogBrowse(
      { products: [], layout: {}, orderKeys: [], nodes, shopId: "shop-b" },
      null,
    );
    expect(a.folders.map((f) => f.identity)).toEqual(["ELECTRONICS"]);
    expect(b.folders.map((f) => f.identity)).toEqual(["FOOD"]);
    expect(a.folders.some((f) => f.identity === "FOOD")).toBe(false);
  });

  it("does not rewrite Product.category, product ids, stock, or create movements", () => {
    const products = [
      product({ id: "p-dell", name: "Dell Laptop A", category: "DELL", stockOnHand: 7 }),
      product({ id: "p-lat", name: "Latitude 5420", category: "LATITUDE", stockOnHand: 3 }),
    ];
    const nodes = electronicsTree.map((n) => ({ ...n }));
    const layout = { DELL: { color: "blue" as const } };
    const orderKeys = ["DELL"];
    const movements = [{ id: "m1", productId: "p-dell", qty: 2 }];
    const sales = [{ id: "s1", total: 1000 }];
    const transfers = [{ id: "t1" }];
    const barcodes = [{ productId: "p-dell", barcode: "123" }];
    const productSnap = structuredClone(products);
    const nodeSnap = structuredClone(nodes);
    const movementSnap = structuredClone(movements);
    const salesSnap = structuredClone(sales);
    const transferSnap = structuredClone(transfers);
    const barcodeSnap = structuredClone(barcodes);

    const index = buildCatalogBrowseIndex({
      products,
      layout,
      orderKeys,
      nodes,
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    resolveCatalogBrowseLevel(index, null);
    resolveCatalogBrowseLevel(index, "DELL");
    resolveCatalogBrowseLevel(index, "LATITUDE");

    expect(products).toEqual(productSnap);
    expect(products.map((p) => p.category)).toEqual(["DELL", "LATITUDE"]);
    expect(products.map((p) => p.id)).toEqual(["p-dell", "p-lat"]);
    expect(products.map((p) => p.stockOnHand)).toEqual([7, 3]);
    expect(nodes).toEqual(nodeSnap);
    expect(movements).toEqual(movementSnap);
    expect(sales).toEqual(salesSnap);
    expect(transfers).toEqual(transferSnap);
    expect(barcodes).toEqual(barcodeSnap);
  });

  it("uses existing Product.category exact-match semantics for direct products", () => {
    const p = product({ id: "p1", name: "Dell Laptop A", category: "DELL" });
    const dell = resolveCatalogBrowse(
      {
        products: [p, product({ id: "p2", name: "Other", category: "LATITUDE" })],
        layout: {},
        orderKeys: [],
        nodes: electronicsTree,
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "DELL",
    );
    expect(dell.directProducts).toHaveLength(1);
    expect(catalogBrowseProductMatchesIdentity(p, "DELL")).toBe(true);
    expect(productMatchesCategoryFilter(p, "DELL")).toBe(true);
    expect(productMatchesCategoryFilter(p, "ELECTRONICS")).toBe(false);
    expect(dell.directProducts.every((row) => productMatchesCategoryFilter(row, "DELL"))).toBe(true);
  });

  it("respects the current rename state without a second identity system", () => {
    const products = [product({ id: "p-dell", name: "Dell Laptop A", category: "DELL" })];
    const layout = { DELL: { color: "blue" as const } };
    const orderKeys = ["DELL"];
    const nodes = [node({ id: "n-dell", legacyShelfKey: "DELL", name: "DELL" })];
    const planned = planShelfRename({ fromKey: "DELL", toName: "DELL LAPTOPS", products, layout, orderKeys });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const renamedProducts = products.map((p) =>
      planned.productIds.includes(p.id) ? { ...p, category: planned.toKey } : p,
    );
    const renamedNodes = remapCatalogNodesForRename(nodes, planned.fromKey, planned.toKey);
    const after = resolveCatalogBrowse(
      {
        products: renamedProducts,
        layout: planned.layout,
        orderKeys: planned.orderKeys,
        nodes: renamedNodes,
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "DELL LAPTOPS",
    );
    expect(after.found).toBe(true);
    expect(after.directProducts.map((p) => p.id)).toEqual(["p-dell"]);
    expect(resolveCatalogBrowse(
      {
        products: renamedProducts,
        layout: planned.layout,
        orderKeys: planned.orderKeys,
        nodes: renamedNodes,
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "DELL",
    ).found).toBe(false);
    expect(renamedProducts[0]?.category).toBe("DELL LAPTOPS");
  });

  it("does not resurrect a deleted empty shelf unless a remaining identity exists", () => {
    const products = [product({ id: "p-dell", name: "Dell", category: "DELL" })];
    const layout = { DELL: { color: "blue" as const }, SPARE: { color: "orange" as const } };
    const orderKeys = ["DELL", "SPARE"];
    const nodes = [
      node({ id: "n-dell", legacyShelfKey: "DELL" }),
      node({ id: "n-spare", legacyShelfKey: "SPARE" }),
    ];
    const before = resolveCatalogBrowse(
      { products, layout, orderKeys, nodes, shopId: LOCAL_CATALOG_SHOP_ID },
      null,
    );
    expect(before.folders.map((f) => f.identity).sort()).toEqual(["DELL", "SPARE"]);

    const deleted = planDeleteEmptyShelf({ shelfKey: "SPARE", products, layout, orderKeys });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    const retired = retireCatalogNodesForDeletedShelf(nodes, "SPARE");
    const after = resolveCatalogBrowse(
      {
        products,
        layout: deleted.layout,
        orderKeys: deleted.orderKeys,
        nodes: retired,
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      null,
    );
    expect(after.folders.map((f) => f.identity)).toEqual(["DELL"]);
    expect(resolveCatalogBrowse(
      {
        products,
        layout: deleted.layout,
        orderKeys: deleted.orderKeys,
        nodes: retired,
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      "SPARE",
    ).found).toBe(false);
  });

  it("does not duplicate a persisted identity as a virtual root", () => {
    const level = resolveCatalogBrowse(
      {
        products: [product({ id: "p-el", name: "Cable", category: "ELECTRONICS" })],
        layout: { ELECTRONICS: { color: "blue" } },
        orderKeys: ["ELECTRONICS"],
        nodes: [node({ id: "n-el", legacyShelfKey: "ELECTRONICS" })],
        shopId: LOCAL_CATALOG_SHOP_ID,
      },
      null,
    );
    expect(level.folders.filter((f) => f.identity === "ELECTRONICS")).toHaveLength(1);
    expect(level.folders[0]?.persisted).toBe(true);
  });

  it("builds an index once and reuses it for nested resolves without rewriting products", () => {
    const products = Array.from({ length: 10_000 }, (_, i) =>
      product({
        id: `p-${i}`,
        name: `Item ${i}`,
        category: i === 0 ? "DELL" : "LATITUDE",
      }),
    );
    const snap = products.map((p) => p.category);
    const index = buildCatalogBrowseIndex({
      products,
      layout: {},
      orderKeys: [],
      nodes: electronicsTree,
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    for (let i = 0; i < 50; i += 1) {
      const dell = resolveCatalogBrowseLevel(index, "DELL");
      expect(dell.directProducts).toHaveLength(1);
      expect(dell.directProducts[0]?.id).toBe("p-0");
      expect(dell.folders.find((f) => f.identity === "LATITUDE")?.inclusiveProductCount).toBe(9_999);
    }
    expect(products.map((p) => p.category)).toEqual(snap);
  });

  it("keeps uncategorized products as a root identity without a CatalogNode", () => {
    const input = {
      products: [
        product({ id: "p-loose", name: "Loose item", category: "" }),
        product({ id: "p-dell", name: "Dell", category: "DELL" }),
      ],
      layout: {},
      orderKeys: ["DELL"] as string[],
      nodes: [] as CatalogNode[],
      shopId: LOCAL_CATALOG_SHOP_ID,
      uncategorizedLabel: "No shelf",
    };
    const root = resolveCatalogBrowse(input, null);
    expect(root.folders.map((f) => f.identity)).toEqual(["DELL", UNCATEGORIZED_SENTINEL]);
    expect(root.folders.find((f) => f.identity === UNCATEGORIZED_SENTINEL)?.label).toBe("No shelf");
    const open = resolveCatalogBrowse(input, UNCATEGORIZED_SENTINEL);
    expect(open.directProducts.map((p) => p.id)).toEqual(["p-loose"]);
  });

  it("does not change flag-off shelf discovery, empty shelves, or exact counts", () => {
    const products = [
      product({ id: "p-dell", name: "Latitude 5420", category: "DELL" }),
      product({ id: "p-hp", name: "EliteBook", category: "HP" }),
      product({ id: "p-lenovo", name: "ThinkPad", category: "LENOVO" }),
    ];
    const layout = { Accessories: { color: "orange" as const, displayName: "Accessories" } };
    const orderKeys = ["DELL", "HP", "LENOVO", "Accessories"];
    const keys = collectShelfCategoryKeys(products, orderKeys, layout);
    const cards = buildPosShelfDisplayCards(products, "No shelf", layout, orderKeys);
    expect(keys).toEqual(["DELL", "HP", "LENOVO", "Accessories"]);
    expect(cards.map((c) => c.key)).toEqual(["DELL", "HP", "LENOVO", "Accessories"]);
    expect(cards.find((c) => c.key === "DELL")?.count).toBe(1);
    expect(cards.find((c) => c.key === "Accessories")?.count).toBe(0);
    expect(productMatchesCategoryFilter(products[0]!, "DELL")).toBe(true);
    expect(productMatchesCategoryFilter(products[0]!, "ELECTRONICS")).toBe(false);
  });
});

describe("catalog browse session path", () => {
  const products = [
    product({ id: "p-laptop-a", name: "Dell Laptop A", category: "DELL" }),
    product({ id: "p-5420", name: "Latitude 5420", category: "LATITUDE" }),
    product({ id: "p-hp", name: "EliteBook", category: "HP" }),
  ];
  const layout = { ACCESSORIES: { color: "orange" as const } };
  const nodes = [
    ...electronicsTree,
    node({ id: "n-acc", legacyShelfKey: "ACCESSORIES", sortOrder: 1 }),
  ];

  function indexFor(extraNodes: CatalogNode[] = []) {
    return buildCatalogBrowseIndex({
      products,
      layout,
      orderKeys: ["ACCESSORIES"],
      nodes: [...nodes, ...extraNodes],
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
  }

  it("pushes folder identities, not UUIDs, and does not dump descendants", () => {
    const index = indexFor();
    const cart = [{ id: "line-1", qty: 2 }];
    const path1 = pushCatalogBrowseIdentity(index, [], "ELECTRONICS");
    const path2 = pushCatalogBrowseIdentity(index, path1, "COMPUTERS");
    const path3 = pushCatalogBrowseIdentity(index, path2, "LAPTOPS");
    const path4 = pushCatalogBrowseIdentity(index, path3, "DELL");
    expect(path4).toEqual(["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"]);
    expect(path4.some((id) => id.startsWith("n-"))).toBe(false);
    const dell = resolveCatalogBrowseLevel(index, path4[path4.length - 1]!);
    expect(dell.folders.map((f) => f.identity)).toEqual(["LATITUDE", "XPS"]);
    expect(dell.directProducts.map((p) => p.id)).toEqual(["p-laptop-a"]);
    expect(dell.directProducts.map((p) => p.id)).not.toContain("p-5420");
    expect(cart).toEqual([{ id: "line-1", qty: 2 }]);
  });

  it("pops exactly one level, then root has no nested back target", () => {
    const path = ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"];
    expect(popCatalogBrowseIdentity(path)).toEqual(["ELECTRONICS", "COMPUTERS", "LAPTOPS"]);
    expect(popCatalogBrowseIdentity(["ELECTRONICS"])).toEqual([]);
    expect(popCatalogBrowseIdentity([])).toEqual([]);
  });

  it("jumps to an ancestor and discards deeper entries", () => {
    const index = indexFor();
    const path = ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"];
    expect(jumpCatalogBrowseToIdentity(index, path, "COMPUTERS")).toEqual([
      "ELECTRONICS",
      "COMPUTERS",
    ]);
    expect(jumpCatalogBrowseToIdentity(index, path, null)).toEqual([]);
  });

  it("drops a deleted identity instead of staying on a ghost shelf", () => {
    const index = indexFor();
    expect(sanitizeCatalogBrowsePath(index, ["ELECTRONICS", "MISSING", "DELL"])).toEqual([
      "ELECTRONICS",
    ]);
    const withoutDell = buildCatalogBrowseIndex({
      products,
      layout,
      orderKeys: ["ACCESSORIES"],
      nodes: electronicsTree.filter((n) => n.legacyShelfKey !== "DELL" && n.parentId !== "n-dell"),
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    expect(
      sanitizeCatalogBrowsePath(withoutDell, ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"]),
    ).toEqual(["ELECTRONICS", "COMPUTERS", "LAPTOPS"]);
  });

  it("maps folder tiles with inclusive counts, not direct-only counts", () => {
    const view = resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS", "LAPTOPS"],
      searchQuery: "",
      index: indexFor(),
      layout,
    });
    expect(view).toBeTruthy();
    const dell = view!.folderCards.find((c) => c.key === "DELL");
    expect(dell?.count).toBe(2);
    expect(view!.directProducts.map((p) => p.id)).toEqual([]);
    const cards = catalogBrowseFoldersToShelfCards(view!.folders, layout);
    expect(cards.find((c) => c.key === "DELL")?.count).toBe(2);
  });

  it("returns null when hierarchy is off so flag-off browsing never uses the resolver", () => {
    expect(
      resolveSellCatalogHierarchyView({
        enabled: false,
        path: ["ELECTRONICS"],
        searchQuery: "",
        index: indexFor(),
        layout,
      }),
    ).toBeNull();
  });

  it("keeps searchActive separate from the current path", () => {
    const view = resolveSellCatalogHierarchyView({
      enabled: true,
      path: ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL"],
      searchQuery: "EliteBook",
      index: indexFor(),
      layout,
    });
    expect(view?.searchActive).toBe(true);
    expect(view?.path.map((e) => e.identity)).toEqual([
      "ELECTRONICS",
      "COMPUTERS",
      "LAPTOPS",
      "DELL",
    ]);
  });
});
