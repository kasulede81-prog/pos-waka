import { describe, expect, it } from "vitest";
import type { ModifierGroup, Product } from "../types";
import {
  buildSaleLineConfigFingerprint,
  buildConfiguredSaleLine,
  defaultModifierSelections,
  modifierPriceTotal,
  validateModifierSelections,
} from "./menuModifiers";
import {
  aggregateRecipeRequirements,
  computeMenuItemMargin,
  shouldDeductFinishedProductStock,
} from "./recipeEngine";
import { validateComboSelections, computeComboLinePriceUgx } from "./comboMeals";

function product(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "ea",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand: 100,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: new Date().toISOString(),
    version: 1,
    ...partial,
  };
}

const cookGroup: ModifierGroup = {
  id: "cook",
  label: "Cooking",
  required: true,
  selectionMode: "single",
  options: [
    { id: "rare", label: "Rare", priceDeltaUgx: 0, isDefault: true },
    { id: "well", label: "Well Done", priceDeltaUgx: 0 },
  ],
};

const cheeseGroup: ModifierGroup = {
  id: "extra",
  label: "Extras",
  required: false,
  selectionMode: "multiple",
  maxSelections: 2,
  options: [
    { id: "cheese", label: "Extra Cheese", priceDeltaUgx: 2_000 },
    { id: "bacon", label: "Extra Bacon", priceDeltaUgx: 4_000 },
  ],
};

describe("menuModifiers", () => {
  it("validates required modifier group", () => {
    const r = validateModifierSelections([cookGroup], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorKey).toBe("modifierRequired");
  });

  it("builds line with modifier price deltas", () => {
    const burger = product({
      id: "burger",
      name: "Burger",
      menu: { productKind: "finished_menu", modifierGroups: [cookGroup, cheeseGroup] },
    });
    const mods = [
      ...defaultModifierSelections([cookGroup]),
      { groupId: "extra", groupLabel: "Extras", optionId: "cheese", optionLabel: "Extra Cheese", priceDeltaUgx: 2_000 },
    ];
    const built = buildConfiguredSaleLine({ product: burger, modifiers: mods });
    expect(built.line?.lineTotalUgx).toBe(12_000);
    expect(modifierPriceTotal(mods)).toBe(2_000);
  });

  it("fingerprints differ when modifiers differ", () => {
    const a = buildSaleLineConfigFingerprint({
      productId: "p1",
      modifiers: [{ groupId: "g", groupLabel: "G", optionId: "a", optionLabel: "A", priceDeltaUgx: 0 }],
    });
    const b = buildSaleLineConfigFingerprint({
      productId: "p1",
      modifiers: [{ groupId: "g", groupLabel: "G", optionId: "b", optionLabel: "B", priceDeltaUgx: 0 }],
    });
    expect(a).not.toBe(b);
  });
});

describe("recipeEngine", () => {
  it("aggregates recipe ingredient requirements", () => {
    void product({ id: "bun", name: "Bun", menu: { productKind: "ingredient" }, stockOnHand: 50 });
    void product({ id: "chicken", name: "Chicken", menu: { productKind: "ingredient" }, stockOnHand: 5 });
    const burger = product({
      id: "burger",
      name: "Chicken Burger",
      menu: {
        productKind: "finished_menu",
        recipe: {
          lines: [
            { ingredientProductId: "bun", quantityBase: 1 },
            { ingredientProductId: "chicken", quantityBase: 0.15 },
          ],
        },
      },
    });
    const req = aggregateRecipeRequirements([{ product: burger, quantity: 2 }]);
    expect(req.get("bun")).toBe(2);
    expect(req.get("chicken")).toBeCloseTo(0.3);
  });

  it("skips finished stock when recipe-driven menu item", () => {
    const burger = product({
      id: "burger",
      name: "Burger",
      menu: { productKind: "finished_menu", recipe: { lines: [{ ingredientProductId: "bun", quantityBase: 1 }] } },
    });
    expect(shouldDeductFinishedProductStock(burger)).toBe(false);
  });

  it("computes food cost margin", () => {
    const bun = product({ id: "bun", name: "Bun", costPricePerUnitUgx: 500, menu: { productKind: "ingredient" } });
    const burger = product({
      id: "burger",
      name: "Burger",
      sellingPricePerUnitUgx: 15_000,
      menu: {
        productKind: "finished_menu",
        recipe: { lines: [{ ingredientProductId: "bun", quantityBase: 1 }] },
      },
    });
    const m = computeMenuItemMargin(burger, [bun, burger]);
    expect(m.foodCostUgx).toBe(500);
    expect(m.marginPct).toBeGreaterThan(90);
  });
});

describe("comboMeals", () => {
  it("uses fixed combo price when set", () => {
    const drink = product({ id: "drink", name: "Soda", sellingPricePerUnitUgx: 3_000 });
    const meal = product({
      id: "meal",
      name: "Burger Meal",
      sellingPricePerUnitUgx: 20_000,
      menu: {
        productKind: "finished_menu",
        combo: {
          comboPriceUgx: 18_000,
          slots: [
            {
              id: "drink",
              label: "Drink",
              required: true,
              choices: [{ productId: "drink" }],
            },
          ],
        },
      },
    });
    const selections = [
      { slotId: "drink", slotLabel: "Drink", productId: "drink", productName: "Soda", priceDeltaUgx: 0 },
    ];
    expect(computeComboLinePriceUgx(meal, selections, [drink, meal])).toBe(18_000);
    const validated = validateComboSelections(meal.menu!.combo!, selections, [drink, meal]);
    expect(validated.ok).toBe(true);
  });
});
