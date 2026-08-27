import { beforeEach, describe, expect, it } from "vitest";
import { usePosStore } from "../store/usePosStore";
import { createDefaultPreferences } from "../data/defaultSeed";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { isCatalogHierarchyEnabled } from "./catalogHierarchy";

describe("createCatalogShelf inventory safety", () => {
  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      products: [
        {
          id: "p-dell",
          name: "Latitude 5420",
          category: "DELL",
          sku: "LAT",
          baseUnit: "piece",
          stockOnHand: 7,
          minimumStockAlert: 0,
          sellingPricePerUnitUgx: 2_000_000,
          costPricePerUnitUgx: 1_500_000,
          sellingMode: "unit",
          updatedAt: "2026-08-01T00:00:00.000Z",
          version: 1,
        },
      ],
      stockMovements: [],
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      preferences: {
        ...createDefaultPreferences(),
        catalogHierarchyEnabled: true,
        onboardingDone: true,
      },
    });
  });

  it("creating a CatalogNode does not create inventory, products, or movements", () => {
    const before = usePosStore.getState();
    const productSnap = before.products.map((p) => ({ ...p }));
    const movementsSnap = [...before.stockMovements];
    const result = usePosStore.getState().createCatalogShelf({ name: "ELECTRONICS" });
    expect(result.ok).toBe(true);
    expect(result.legacyShelfKey).toBe("ELECTRONICS");
    const after = usePosStore.getState();
    expect(after.products).toEqual(productSnap);
    expect(after.products[0]?.id).toBe("p-dell");
    expect(after.products[0]?.category).toBe("DELL");
    expect(after.products[0]?.stockOnHand).toBe(7);
    expect(after.stockMovements).toEqual(movementsSnap);
    expect(after.preferences.posCatalogNodes?.some((n) => n.legacyShelfKey === "ELECTRONICS")).toBe(true);
  });

  it("moving a product to a node identity does not create a stock movement", () => {
    usePosStore.getState().createCatalogShelf({ name: "ELECTRONICS" });
    const beforeMovements = [...usePosStore.getState().stockMovements];
    const beforeStock = usePosStore.getState().products[0]?.stockOnHand;
    const r = usePosStore.getState().updateProduct("p-dell", { category: "ELECTRONICS" });
    expect(r.ok).toBe(true);
    const after = usePosStore.getState();
    expect(after.products[0]?.category).toBe("ELECTRONICS");
    expect(after.products[0]?.id).toBe("p-dell");
    expect(after.products[0]?.stockOnHand).toBe(beforeStock);
    expect(after.stockMovements).toEqual(beforeMovements);
  });

  it("renaming a CatalogNode identity does not modify stock", () => {
    usePosStore.getState().createCatalogShelf({ name: "DELL" });
    const beforeStock = usePosStore.getState().products[0]?.stockOnHand;
    const r = usePosStore.getState().renameShelfCategory("DELL", "DELL LAPTOPS");
    expect(r.ok).toBe(true);
    const after = usePosStore.getState();
    expect(after.products[0]?.category).toBe("DELL LAPTOPS");
    expect(after.products[0]?.stockOnHand).toBe(beforeStock);
    expect(after.preferences.posCatalogNodes?.some((n) => n.legacyShelfKey === "DELL LAPTOPS")).toBe(true);
  });

  it("deleting an empty CatalogNode does not modify products", () => {
    usePosStore.getState().createCatalogShelf({ name: "SPARE" });
    const productSnap = usePosStore.getState().products.map((p) => ({ ...p }));
    const r = usePosStore.getState().deleteEmptyShelf("SPARE");
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().products).toEqual(productSnap);
    expect(usePosStore.getState().preferences.posCatalogNodes?.some((n) => n.legacyShelfKey === "SPARE")).toBe(
      false,
    );
  });

  it("flag remains off for shops that never opted in", () => {
    usePosStore.setState({
      preferences: { ...createDefaultPreferences(), onboardingDone: true },
    });
    expect(isCatalogHierarchyEnabled(usePosStore.getState().preferences)).toBe(false);
  });
});
