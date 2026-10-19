import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import { usePosStore } from "../store/usePosStore";
import {
  hospitalityMenuCostState,
  isHospitalityMenuItem,
  isHospitalityRecipeDish,
  isHospitalityResaleItem,
  zeroCostRecipeIngredientIds,
} from "./hospitalityMenuCosting";
import { mergeProductCatalogFields } from "./inventoryIntegrity";
import { lowMarginMenuItems } from "./menuReports";
import { defaultWizardUnitCostUgx } from "./simpleProductWizard";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { WALK_IN_SUPPLIER_ID } from "./walkInSupplier";

function product(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "plate",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 7_200, // the quick-add 72% default
    stockOnHand: 0,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: "2026-10-19T08:00:00.000Z",
    version: 1,
    ...partial,
  };
}

const chicken = product({
  id: "chicken",
  name: "Chicken",
  category: "Food",
  baseUnit: "kg",
  costPricePerUnitUgx: 8_000,
  stockOnHand: 10,
  menu: { productKind: "ingredient" },
});

const rice = product({
  id: "rice",
  name: "Rice",
  category: "Food",
  baseUnit: "kg",
  costPricePerUnitUgx: 4_000,
  stockOnHand: 20,
  menu: { productKind: "ingredient" },
});

function seedEmptyStore() {
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
      businessType: "kiosk_duka",
      onboardingDone: true,
      onboardingWizardDone: true,
    },
  });
}

function dish(overrides: Partial<Product> = {}): Product {
  return product({
    id: "dish",
    name: "Chicken plate",
    menu: {
      productKind: "finished_menu",
      recipe: {
        yieldQty: 4,
        lines: [{ ingredientProductId: "chicken", quantityBase: 1, unitLabel: "kg" }],
      },
    },
    ...overrides,
  });
}

describe("Hospitality menu costing honesty", () => {
  it("does not turn a no-recipe product's 72% quick-add cost into a margin", () => {
    const uncosted = product({ id: "no-recipe", name: "Pilau", category: "Food" });
    const state = hospitalityMenuCostState(uncosted, [uncosted]);
    expect(state.status).toBe("not_set");
    expect("marginPct" in state).toBe(false);
    expect(lowMarginMenuItems([uncosted], 35)).toHaveLength(0);
  });

  it("labels a complete recipe as an estimate and computes its margin", () => {
    const state = hospitalityMenuCostState(dish(), [dish(), chicken]);
    expect(state.status).toBe("estimated");
    if (state.status !== "estimated") return;
    // 1 kg chicken at 8,000 over a 4-plate yield = 2,000 food cost / plate.
    expect(state.foodCostUgx).toBe(2_000);
    expect(state.sellPriceUgx).toBe(10_000);
    expect(state.profitUgx).toBe(8_000);
    expect(state.marginPct).toBe(80);
    expect(state.incomplete).toBe(false);
  });

  it("marks a recipe incomplete when an ingredient product is missing", () => {
    const broken = dish({
      menu: {
        productKind: "finished_menu",
        recipe: {
          yieldQty: 4,
          lines: [{ ingredientProductId: "ghost", quantityBase: 1, unitLabel: "kg" }],
        },
      },
    });
    const state = hospitalityMenuCostState(broken, [broken]);
    expect(state.status).toBe("estimated");
    if (state.status !== "estimated") return;
    expect(state.incomplete).toBe(true);
    expect(state.missingIngredientIds).toContain("ghost");
    expect(lowMarginMenuItems([broken], 35)).toHaveLength(0);
  });

  it("marks a recipe incomplete when an ingredient has no cost price", () => {
    const freeRice = { ...rice, costPricePerUnitUgx: 0 };
    const riceDish = dish({
      id: "rice-dish",
      name: "Rice plate",
      menu: {
        productKind: "finished_menu",
        recipe: {
          yieldQty: 10,
          lines: [{ ingredientProductId: "rice", quantityBase: 5, unitLabel: "kg" }],
        },
      },
    });
    expect(zeroCostRecipeIngredientIds(riceDish, [riceDish, freeRice])).toEqual(["rice"]);
    const state = hospitalityMenuCostState(riceDish, [riceDish, freeRice]);
    expect(state.status).toBe("estimated");
    if (state.status !== "estimated") return;
    expect(state.incomplete).toBe(true);
    expect(state.zeroCostIngredientIds).toEqual(["rice"]);
    expect(lowMarginMenuItems([riceDish], 35)).toHaveLength(0);
  });

  it("scopes the recipe-cost requirement to Hospitality menu items, excluding ingredients", () => {
    expect(isHospitalityMenuItem(product({ id: "f", name: "Pilau", category: "Food" }))).toBe(true);
    expect(isHospitalityMenuItem(product({ id: "m", name: "Plate", category: "Main" }))).toBe(true);
    // Drinks are menu items too: the quick-add default can affect them.
    expect(isHospitalityMenuItem(product({ id: "d", name: "Soda", category: "Drinks" }))).toBe(true);
    expect(isHospitalityMenuItem(chicken)).toBe(false);
    expect(
      isHospitalityMenuItem(
        product({ id: "s", name: "Sauce base", menu: { productKind: "semi_finished" } }),
      ),
    ).toBe(false);
    expect(
      isHospitalityMenuItem(
        product({ id: "f2", name: "Dish", category: "General", menu: { productKind: "finished_menu" } }),
      ),
    ).toBe(true);
  });

  it("keeps the retail quick-add default unchanged", () => {
    expect(defaultWizardUnitCostUgx(10_000)).toBe(7_200);
    expect(defaultWizardUnitCostUgx(1_000)).toBe(720);
  });

  it("keeps a Kiosk Duka quick-add on the existing 72% cost path", () => {
    seedEmptyStore();
    const added = usePosStore.getState().quickAddProduct({
      name: "Soap",
      priceUgx: 1_000,
      stockQty: 10,
      category: "General",
      inferName: "soap",
    });
    expect(added.ok).toBe(true);
    const soap = usePosStore.getState().products.find((p) => p.name === "Soap");
    expect(soap?.costPricePerUnitUgx).toBe(720);
    expect(soap?.costSource).toBe("quick_add_default");
  });

  it("marks an explicit quick-add cost as manual", () => {
    seedEmptyStore();
    const added = usePosStore.getState().quickAddProduct({
      name: "Cola",
      priceUgx: 2_000,
      stockQty: 10,
      category: "Drinks",
      costPricePerUnitUgx: 1_200,
    });
    expect(added.ok).toBe(true);
    const cola = usePosStore.getState().products.find((p) => p.name === "Cola");
    expect(cola?.costPricePerUnitUgx).toBe(1_200);
    expect(cola?.costSource).toBe("manual");
  });

  it("marks an explicit product cost edit as manual", () => {
    seedEmptyStore();
    const sugar = product({
      id: "sugar",
      name: "Sugar",
      category: "General",
      costPricePerUnitUgx: 720,
      costSource: "quick_add_default",
    });
    usePosStore.setState({ products: [sugar] });
    const result = usePosStore.getState().updateProduct("sugar", { costPricePerUnitUgx: 500 });
    expect(result.ok).toBe(true);
    const updated = usePosStore.getState().products.find((p) => p.id === "sugar");
    expect(updated?.costPricePerUnitUgx).toBe(500);
    expect(updated?.costSource).toBe("manual");
  });

  it("marks a supplier purchase cost as purchase provenance", () => {
    seedEmptyStore();
    const soda = product({
      id: "soda-purchase",
      name: "Soda",
      category: "Drinks",
      baseUnit: "bottle",
      stockOnHand: 0,
      costPricePerUnitUgx: 0,
      costSource: "quick_add_default",
    });
    usePosStore.setState({ products: [soda] });
    const result = usePosStore.getState().recordPurchase({
      supplierId: WALK_IN_SUPPLIER_ID,
      supplierName: "Town",
      lines: [{ productId: "soda-purchase", qtyBuyingUnits: 10, costPerBuyingUnitUgx: 1_000 }],
      amountPaidUgx: 10_000,
    });
    expect(result.ok).toBe(true);
    const received = usePosStore.getState().products.find((p) => p.id === "soda-purchase");
    expect(received?.costPricePerUnitUgx).toBe(1_000);
    expect(received?.costSource).toBe("purchase");
  });

  it("shows verified shared product cost for manual or purchase resale items", () => {
    const manualSoda = product({
      id: "soda-manual",
      name: "Soda",
      category: "Drinks",
      sellingPricePerUnitUgx: 2_000,
      costPricePerUnitUgx: 1_200,
      costSource: "manual",
    });
    const manual = hospitalityMenuCostState(manualSoda, [manualSoda]);
    expect(manual.status).toBe("verified_product_cost");
    if (manual.status !== "verified_product_cost") return;
    expect(manual.costSource).toBe("manual");
    expect(manual.foodCostUgx).toBe(1_200);
    expect(manual.profitUgx).toBe(800);
    expect(manual.marginPct).toBe(40);
    expect(lowMarginMenuItems([manualSoda], 50)).toHaveLength(1);

    const purchaseSoda = { ...manualSoda, id: "soda-purchase-state", costSource: "purchase" as const };
    const purchase = hospitalityMenuCostState(purchaseSoda, [purchaseSoda]);
    expect(purchase.status).toBe("verified_product_cost");
    if (purchase.status === "verified_product_cost") {
      expect(purchase.costSource).toBe("purchase");
    }
  });

  it("does not treat a quick-add default or unknown old cost as verified", () => {
    const generated = product({
      id: "soda-generated",
      name: "Soda",
      category: "Drinks",
      sellingPricePerUnitUgx: 2_000,
      costPricePerUnitUgx: 1_440,
      costSource: "quick_add_default",
    });
    expect(hospitalityMenuCostState(generated, [generated])).toEqual({
      status: "unverified_product_cost",
      reason: "quick_add_default",
    });

    const old = product({
      id: "soda-old",
      name: "Soda",
      category: "Drinks",
      sellingPricePerUnitUgx: 2_000,
      costPricePerUnitUgx: 1_440,
    });
    expect(hospitalityMenuCostState(old, [old])).toEqual({
      status: "unverified_product_cost",
      reason: "unknown",
    });

    const zero = product({
      id: "soda-zero",
      name: "Soda",
      category: "Drinks",
      costPricePerUnitUgx: 0,
      costSource: "manual",
    });
    expect(hospitalityMenuCostState(zero, [zero])).toEqual({
      status: "unverified_product_cost",
      reason: "not_set",
    });
  });

  it("keeps recipe dishes on the recipe path even when a product cost exists", () => {
    const uncostedDish = product({
      id: "no-recipe-dish",
      name: "Pilau",
      category: "Food",
      costSource: "manual",
    });
    expect(hospitalityMenuCostState(uncostedDish, [uncostedDish]).status).toBe("not_set");
    expect(isHospitalityRecipeDish(uncostedDish)).toBe(true);
    expect(isHospitalityResaleItem(uncostedDish)).toBe(false);

    const soda = product({ id: "soda-resale", name: "Soda", category: "Drinks" });
    expect(isHospitalityRecipeDish(soda)).toBe(false);
    expect(isHospitalityResaleItem(soda)).toBe(true);
  });

  it("carries cost provenance through the existing product catalog merge", () => {
    const local = product({
      id: "soda-sync",
      name: "Soda",
      category: "Drinks",
      costPricePerUnitUgx: 1_440,
      costSource: "quick_add_default",
      updatedAt: "2026-10-01T00:00:00.000Z",
      version: 1,
    });
    const remote = {
      ...local,
      costPricePerUnitUgx: 1_000,
      costSource: "purchase" as const,
      updatedAt: "2026-10-19T00:00:00.000Z",
      version: 2,
    };
    const merged = mergeProductCatalogFields(local, remote);
    expect(merged.costPricePerUnitUgx).toBe(1_000);
    expect(merged.costSource).toBe("purchase");
  });
});
