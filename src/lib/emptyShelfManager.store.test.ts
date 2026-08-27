import { beforeEach, describe, expect, it } from "vitest";
import { usePosStore } from "../store/usePosStore";
import { createDefaultPreferences } from "../data/defaultSeed";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { LOCAL_CATALOG_SHOP_ID } from "./catalogHierarchy";
import type { CatalogNode, Product } from "../types";
import { PHARMACY_CATEGORY_PRESETS } from "./pharmacy";
import { defaultMenuCategoriesForBusinessType } from "./hospitality";

function product(partial: Partial<Product> & { id: string; category: string }): Product {
  return {
    name: partial.name ?? partial.id,
    sku: partial.sku ?? "SKU-1",
    baseUnit: "piece",
    stockOnHand: partial.stockOnHand ?? 4,
    minimumStockAlert: 0,
    sellingPricePerUnitUgx: 2_000_000,
    costPricePerUnitUgx: 1_500_000,
    sellingMode: "unit",
    updatedAt: "2026-08-01T00:00:00.000Z",
    version: 1,
    pharmacyMaster: partial.pharmacyMaster ?? { barcodes: ["888"] },
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
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("empty shelf manager store — delete and refill safety", () => {
  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      products: [
        product({ id: "p-lat", name: "Dell Latitude 5420", category: "OLD LAPTOPS", sku: "LAT-5420", stockOnHand: 4 }),
        product({ id: "p-hp", name: "HP EliteBook", category: "HP", sku: "HP-1", stockOnHand: 8 }),
      ],
      stockMovements: [],
      sales: [],
      purchases: [],
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      preferences: {
        ...createDefaultPreferences(),
        onboardingDone: true,
        posShelfLayout: {
          DELL: { color: "blue" },
          "OLD LAPTOPS": { color: "orange" },
          HP: { color: "green" },
          ACCESSORIES: { color: "red" },
        },
        posPinnedShelfKeys: ["DELL", "OLD LAPTOPS", "HP", "ACCESSORIES"],
        posSellCategoryFilter: "DELL",
      },
    });
  });

  it("19. bulk delete issues one preference update", () => {
    let prefWrites = 0;
    const unsub = usePosStore.subscribe((s, prev) => {
      if (s.preferences !== prev.preferences) prefWrites += 1;
    });
    const result = usePosStore.getState().deleteEmptyShelves(["DELL", "ACCESSORIES"]);
    unsub();
    expect(result.ok).toBe(true);
    expect(result.deletedCount).toBe(2);
    expect(prefWrites).toBe(1);
  });

  it("20. delete empty shelves does not change products, stock, sales, or movements", () => {
    const before = usePosStore.getState();
    const productSnap = before.products.map((p) => ({ ...p, pharmacyMaster: { ...p.pharmacyMaster } }));
    const movementsSnap = [...before.stockMovements];
    const salesSnap = [...before.sales];
    const r = usePosStore.getState().deleteEmptyShelves(["DELL", "ACCESSORIES"]);
    expect(r.ok).toBe(true);
    const after = usePosStore.getState();
    expect(after.products).toEqual(productSnap);
    expect(after.stockMovements).toEqual(movementsSnap);
    expect(after.sales).toEqual(salesSnap);
    expect(after.preferences.posShelfLayout?.DELL).toBeUndefined();
    expect(after.preferences.posShelfLayout?.ACCESSORIES).toBeUndefined();
    expect(after.preferences.posShelfLayout?.HP).toBeTruthy();
    expect(after.preferences.posSellCategoryFilter).toBeNull();
  });

  it("18. stale occupied selection is not deleted at commit", () => {
    const r = usePosStore.getState().deleteEmptyShelves(["OLD LAPTOPS", "DELL"]);
    expect(r.ok).toBe(true);
    expect(r.deletedCount).toBe(1);
    expect(r.skippedOccupiedCount).toBe(1);
    expect(usePosStore.getState().preferences.posShelfLayout?.["OLD LAPTOPS"]).toBeTruthy();
    expect(usePosStore.getState().preferences.posShelfLayout?.DELL).toBeUndefined();
  });

  it("keeps existing single deleteEmptyShelf working", () => {
    const r = usePosStore.getState().deleteEmptyShelf("ACCESSORIES");
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().preferences.posShelfLayout?.ACCESSORIES).toBeUndefined();
    expect(usePosStore.getState().products).toHaveLength(2);
  });

  it("22–31. refill moves category only — id, sku, barcode, stock, movements, sales unchanged", () => {
    const before = usePosStore.getState().products.find((p) => p.id === "p-lat")!;
    const movementsSnap = [...usePosStore.getState().stockMovements];
    const salesSnap = [...usePosStore.getState().sales];
    const r = usePosStore.getState().refillEmptyShelf("DELL", ["p-lat"]);
    expect(r.ok).toBe(true);
    expect(r.movedCount).toBe(1);
    expect(r.failedCount).toBe(0);
    const after = usePosStore.getState().products.find((p) => p.id === "p-lat")!;
    expect(after.category).toBe("DELL");
    expect(after.id).toBe(before.id);
    expect(after.sku).toBe(before.sku);
    expect(after.pharmacyMaster?.barcodes).toEqual(before.pharmacyMaster?.barcodes);
    expect(after.stockOnHand).toBe(before.stockOnHand);
    expect("catalogNodeId" in after).toBe(false);
    expect(usePosStore.getState().stockMovements).toEqual(movementsSnap);
    expect(usePosStore.getState().sales).toEqual(salesSnap);
  });

  it("23. refill moves multiple products", () => {
    const stocks = usePosStore.getState().products.map((p) => p.stockOnHand);
    const r = usePosStore.getState().refillEmptyShelf("DELL", ["p-lat", "p-hp"]);
    expect(r.ok).toBe(true);
    expect(r.movedCount).toBe(2);
    expect(usePosStore.getState().products.every((p) => p.category === "DELL")).toBe(true);
    expect(usePosStore.getState().products.map((p) => p.stockOnHand)).toEqual(stocks);
  });

  it("33. hierarchy destination uses CatalogNode legacyShelfKey", () => {
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        catalogHierarchyEnabled: true,
        posCatalogNodes: [
          node({ id: "n-el", legacyShelfKey: "ELECTRONICS", name: "Electronics" }),
          node({
            id: "n-dell",
            legacyShelfKey: "DELL",
            name: "Dell",
            parentId: "n-el",
          }),
        ],
      },
    });
    const r = usePosStore.getState().refillEmptyShelf("DELL", ["p-lat"]);
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().products.find((p) => p.id === "p-lat")?.category).toBe("DELL");
    expect(usePosStore.getState().stockMovements).toEqual([]);
  });

  it("34. cashier cannot refill", () => {
    usePosStore.setState({
      sessionActor: { userId: "cashier:1", role: "cashier", displayName: "Cashier" },
    });
    const before = usePosStore.getState().products.map((p) => ({ ...p }));
    const r = usePosStore.getState().refillEmptyShelf("DELL", ["p-lat"]);
    expect(r.ok).toBe(true);
    expect(r.movedCount).toBe(0);
    expect(r.failedCount).toBe(1);
    expect(usePosStore.getState().products).toEqual(before);
  });

  it("36. partial failure is reported", () => {
    const r = usePosStore.getState().refillEmptyShelf("DELL", ["p-lat", "missing-id"]);
    expect(r.ok).toBe(true);
    expect(r.movedCount).toBe(1);
    expect(r.failedCount).toBe(1);
    expect(usePosStore.getState().products.find((p) => p.id === "p-lat")?.category).toBe("DELL");
  });

  it("parent with children is not bulk-deleted when hierarchy is on", () => {
    const electronics = node({ id: "n-el", legacyShelfKey: "ELECTRONICS" });
    const computers = node({ id: "n-comp", legacyShelfKey: "COMPUTERS", parentId: electronics.id });
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        catalogHierarchyEnabled: true,
        posCatalogNodes: [electronics, computers],
        posShelfLayout: { ELECTRONICS: {}, COMPUTERS: {} },
        posPinnedShelfKeys: ["ELECTRONICS", "COMPUTERS"],
      },
    });
    const r = usePosStore.getState().deleteEmptyShelves(["ELECTRONICS"]);
    expect(r.deletedCount).toBe(0);
    expect(r.skippedBlockedCount).toBe(1);
    expect(usePosStore.getState().preferences.posCatalogNodes?.map((n) => n.id).sort()).toEqual(["n-comp", "n-el"]);
  });

  it("leaf CatalogNode delete does not touch inventory", () => {
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        catalogHierarchyEnabled: true,
        posCatalogNodes: [node({ id: "n-acc", legacyShelfKey: "ACCESSORIES" })],
      },
    });
    const productSnap = usePosStore.getState().products.map((p) => p.stockOnHand);
    const r = usePosStore.getState().deleteEmptyShelves(["ACCESSORIES"]);
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().preferences.posCatalogNodes ?? []).toEqual([]);
    expect(usePosStore.getState().products.map((p) => p.stockOnHand)).toEqual(productSnap);
  });

  it("37. hierarchy OFF bulk delete still uses flat identities", () => {
    expect(usePosStore.getState().preferences.catalogHierarchyEnabled).not.toBe(true);
    const r = usePosStore.getState().deleteEmptyShelves(["DELL"]);
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().preferences.posShelfLayout?.DELL).toBeUndefined();
    expect(usePosStore.getState().products[0]?.stockOnHand).toBe(4);
  });

  it("pharmacy preset names stay in the source array after a protected skip", () => {
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "pharmacy",
        posShelfLayout: { Antibiotics: {} },
        posPinnedShelfKeys: ["Antibiotics"],
      },
    });
    const r = usePosStore.getState().deleteEmptyShelves(["Antibiotics"]);
    expect(r.deletedCount).toBe(0);
    expect(PHARMACY_CATEGORY_PRESETS).toContain("Antibiotics");
    expect(usePosStore.getState().preferences.posShelfLayout?.Antibiotics).toEqual({});
  });

  it("refill into a pharmacy preset identity only changes Product.category", () => {
    const stock = usePosStore.getState().products.find((p) => p.id === "p-lat")!.stockOnHand;
    const r = usePosStore.getState().refillEmptyShelf("Antibiotics", ["p-lat"]);
    expect(r.ok).toBe(true);
    expect(r.movedCount).toBe(1);
    const after = usePosStore.getState().products.find((p) => p.id === "p-lat")!;
    expect(after.category).toBe("Antibiotics");
    expect(after.stockOnHand).toBe(stock);
    expect(usePosStore.getState().stockMovements).toEqual([]);
  });

  it("hospitality preset names stay in the source array after a protected skip", () => {
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "restaurant",
        hospitalityModeEnabled: true,
        posShelfLayout: { Food: {} },
        posPinnedShelfKeys: ["Food"],
      },
    });
    const r = usePosStore.getState().deleteEmptyShelves(["Food"]);
    expect(r.deletedCount).toBe(0);
    expect(defaultMenuCategoriesForBusinessType("restaurant")).toContain("Food");
  });
});
