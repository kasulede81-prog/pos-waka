import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import { usePosStore } from "../store/usePosStore";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { initialMenuConfigForProduct } from "./menuModifiers";
import { STALE_RESET_GUARDED_KINDS } from "./staleResetOutbox";
import {
  hospitalityMenuCostState,
  isHospitalityRecipeDish,
} from "./hospitalityMenuCosting";
import { hospitalityPullCursorKey } from "../offline/hospitalityCloudSync";

function seedHospitalityOwner() {
  setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
  usePosStore.setState({
    _hydrated: true,
    products: [],
    stockMovements: [],
    sales: [],
    purchases: [],
    suppliers: [],
    customers: [],
    auditLogs: [],
    dayCloses: [],
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    preferences: {
      ...createDefaultPreferences(),
      businessType: "restaurant",
      hospitalityModeEnabled: true,
      onboardingDone: true,
      onboardingWizardDone: true,
    },
  });
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Hospitality inventory on the shared Kiosk Duka product model", () => {
  beforeEach(() => {
    seedHospitalityOwner();
  });

  it("creates an ingredient with zero selling price and shared stock/cost fields", () => {
    const result = usePosStore.getState().quickAddProduct({
      name: "Chicken",
      priceUgx: 0,
      stockQty: 10,
      category: "Ingredients",
      baseUnit: "kg",
      sellingMode: "weighted",
      costPricePerUnitUgx: 8_000,
      minimumStockAlert: 2,
      menu: { productKind: "ingredient" },
      allowZeroSellingPrice: true,
    });

    expect(result.ok).toBe(true);
    const product = usePosStore.getState().products[0]!;
    expect(product).toMatchObject({
      name: "Chicken",
      sellingPricePerUnitUgx: 0,
      costPricePerUnitUgx: 8_000,
      stockOnHand: 10,
      baseUnit: "kg",
      minimumStockAlert: 2,
    });
    expect(product.menu?.productKind).toBe("ingredient");
  });

  it("preserves the retail rule that a product needs a selling price", () => {
    const result = usePosStore.getState().quickAddProduct({
      name: "Soda",
      priceUgx: 0,
      stockQty: 5,
      category: "Drinks",
    });
    expect(result.ok).toBe(false);
    expect(usePosStore.getState().products).toHaveLength(0);
  });

  it("keeps retail creation unchanged when no menu config is supplied", () => {
    const result = usePosStore.getState().quickAddProduct({
      name: "Soda",
      priceUgx: 1_000,
      stockQty: 5,
      category: "Drinks",
    });
    expect(result.ok).toBe(true);
    const product = usePosStore.getState().products[0]!;
    expect(product.menu).toBeUndefined();
    expect(product.costPricePerUnitUgx).toBe(720); // existing retail 72% default
    expect(product.stockOnHand).toBe(5);
  });

  it("creates a batch-prepared dish with a recipe and zero opening stock", () => {
    const ingredient = usePosStore.getState().quickAddProduct({
      name: "Chicken",
      priceUgx: 0,
      stockQty: 10,
      category: "Ingredients",
      baseUnit: "kg",
      sellingMode: "weighted",
      costPricePerUnitUgx: 8_000,
      menu: { productKind: "ingredient" },
      allowZeroSellingPrice: true,
    });
    expect(ingredient.ok).toBe(true);
    const chickenId = usePosStore.getState().products[0]!.id;

    const dish = usePosStore.getState().quickAddProduct({
      name: "Chicken plate",
      priceUgx: 12_000,
      stockQty: 0,
      category: "Food",
      baseUnit: "plate",
      sellingMode: "unit",
      costPricePerUnitUgx: 0,
      minimumStockAlert: 2,
      menu: {
        productKind: "finished_menu",
        prepMode: "batch_prepared",
        menuSection: "food",
        recipe: {
          yieldQty: 4,
          lines: [{ ingredientProductId: chickenId, quantityBase: 1, unitLabel: "kg" }],
        },
        prepBatches: [],
        modifierGroups: [],
      },
    });

    expect(dish.ok).toBe(true);
    const product = usePosStore.getState().products.find((p) => p.name === "Chicken plate")!;
    expect(product.stockOnHand).toBe(0);
    expect(product.menu?.productKind).toBe("finished_menu");
    expect(product.menu?.prepMode).toBe("batch_prepared");
    expect(product.menu?.recipe?.yieldQty).toBe(4);
    expect(product.menu?.recipe?.lines).toEqual([
      { ingredientProductId: chickenId, quantityBase: 1, unitLabel: "kg" },
    ]);
    expect(isHospitalityRecipeDish(product)).toBe(true);
    expect(hospitalityMenuCostState(product, usePosStore.getState().products)).toMatchObject({
      status: "estimated",
      incomplete: false,
      foodCostUgx: 2_000, // 8,000 / 4 plates
    });
  });

  it("seeds Menu Builder from the product's real kind, not an invented dish", () => {
    expect(initialMenuConfigForProduct({ menu: undefined }).productKind).toBe("retail");
    expect(
      initialMenuConfigForProduct({ menu: { productKind: "ingredient" } }).productKind,
    ).toBe("ingredient");
  });

  it("guards the Hospitality floor/session outbox across a reset", () => {
    expect(STALE_RESET_GUARDED_KINDS.has("pending_hospitality")).toBe(true);
  });

  it("scopes the Hospitality pull cursor per shop", () => {
    expect(hospitalityPullCursorKey("shop-a")).not.toBe(hospitalityPullCursorKey("shop-b"));
    expect(hospitalityPullCursorKey("shop-a")).toContain("shop-a");
  });

  it("mounts the Hospitality add sheet from the /stock add deep link", () => {
    const stock = src("src/pages/StockPage.tsx");
    expect(stock).toContain("HospitalityAddItemSheet");
    expect(stock).toContain("setHospitalityAddOpen(true)");
    expect(stock).toContain('searchParams.get("add") === "1"');
  });

  it("does not discard a failed Menu Builder save and keeps recipe ingredients separate from combo items", () => {
    const menuBuilder = src("src/pages/MenuBuilderPage.tsx");
    expect(menuBuilder).toContain("const result = updateProduct(selected.id, { menu });");
    expect(menuBuilder).toContain("if (!result.ok)");
    expect(menuBuilder).toContain("ingredientProducts={ingredientProducts}");
    expect(menuBuilder).toContain("comboProducts=");
  });
});
