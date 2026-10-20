/**
 * Recipe entry in buying units.
 *
 * Conversion happens only at the editor boundary; every stored `quantityBase`
 * stays canonical. These tests also run the real batch-preparation action to
 * prove deduction, frozen cost and audit behavior are unchanged.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Product, RecipeLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import {
  buildRecipeLineFromEntry,
  formatRecipeQuantityInput,
  parseRecipeQuantityInput,
  recipePackUnitForIngredient,
  recipeQuantityForEntry,
  recipeQuantityToBase,
} from "./recipeQuantityUnits";

const NOW = "2026-10-20T08:00:00.000Z";

function product(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "pcs",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand: 20,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: NOW,
    version: 1,
    ...partial,
  };
}

const chicken = product({
  id: "chicken-pack",
  name: "Chicken",
  baseUnit: "kg",
  buyingUnit: "sack",
  conversionRate: 10,
  costPricePerUnitUgx: 8_000,
  stockOnHand: 10,
  menu: { productKind: "ingredient" },
});

const potatoes = product({
  id: "potatoes-pack",
  name: "Potatoes",
  baseUnit: "kg",
  buyingUnit: "sack",
  conversionRate: 20,
  costPricePerUnitUgx: 2_000,
  stockOnHand: 20,
  menu: { productKind: "ingredient" },
});

const oil = product({
  id: "oil-pack",
  name: "Cooking Oil",
  baseUnit: "L",
  buyingUnit: "jerrican",
  conversionRate: 5,
  costPricePerUnitUgx: 6_000,
  stockOnHand: 5,
  menu: { productKind: "ingredient" },
});

describe("recipe buying-unit conversion", () => {
  it("uses the configured buying unit and strips a supplier suffix", () => {
    expect(
      recipePackUnitForIngredient(
        product({ id: "rice", name: "Rice", baseUnit: "kg", buyingUnit: "sack · Kigali", conversionRate: 50 }),
      ),
    ).toEqual({ label: "sack", baseUnit: "kg", baseUnitsPerPack: 50 });
  });

  it("rejects missing, zero, negative and non-finite conversions", () => {
    const base = { id: "x", name: "X", baseUnit: "kg" };
    expect(recipePackUnitForIngredient(product({ ...base, buyingUnit: null, conversionRate: 50 }))).toBeNull();
    expect(recipePackUnitForIngredient(product({ ...base, buyingUnit: "sack", conversionRate: null }))).toBeNull();
    expect(recipePackUnitForIngredient(product({ ...base, buyingUnit: "sack", conversionRate: 0 }))).toBeNull();
    expect(recipePackUnitForIngredient(product({ ...base, buyingUnit: "sack", conversionRate: -5 }))).toBeNull();
    expect(recipePackUnitForIngredient(product({ ...base, buyingUnit: "sack", conversionRate: Number.NaN }))).toBeNull();
    expect(
      recipePackUnitForIngredient(product({ ...base, buyingUnit: "sack", conversionRate: Number.POSITIVE_INFINITY })),
    ).toBeNull();
  });

  it("converts fractional packs to base units and removes float noise", () => {
    const sack50 = { label: "sack", baseUnit: "kg", baseUnitsPerPack: 50 };
    expect(recipeQuantityToBase(0.1, "pack", sack50)).toBe(5);
    expect(recipeQuantityToBase(2.5, "pack", { label: "crate", baseUnit: "piece", baseUnitsPerPack: 12 })).toBe(30);
    expect(recipeQuantityToBase(0.1, "pack", { label: "tin", baseUnit: "kg", baseUnitsPerPack: 30 })).toBe(3);
  });

  it("keeps base-unit input exactly as typed", () => {
    const sack50 = { label: "sack", baseUnit: "kg", baseUnitsPerPack: 50 };
    expect(recipeQuantityToBase(0.25, "base", sack50)).toBe(0.25);
    expect(recipeQuantityToBase(5, "base", null)).toBe(5);
  });

  it("fails safely for invalid quantities and unusable packs", () => {
    const sack50 = { label: "sack", baseUnit: "kg", baseUnitsPerPack: 50 };
    expect(recipeQuantityToBase(Number.NaN, "pack", sack50)).toBeNull();
    expect(recipeQuantityToBase(Number.POSITIVE_INFINITY, "pack", sack50)).toBeNull();
    expect(recipeQuantityToBase(-1, "pack", sack50)).toBeNull();
    expect(recipeQuantityToBase(1, "pack", null)).toBeNull();
    expect(recipeQuantityToBase(1, "pack", { label: "sack", baseUnit: "kg", baseUnitsPerPack: 0 })).toBeNull();
    expect(recipeQuantityToBase(0, "pack", sack50)).toBe(0);
  });

  it("displays a canonical base quantity in the selected entry unit", () => {
    const sack50 = { label: "sack", baseUnit: "kg", baseUnitsPerPack: 50 };
    expect(recipeQuantityForEntry(5, "pack", sack50)).toBe(0.1);
    expect(recipeQuantityForEntry(30, "pack", { label: "crate", baseUnit: "piece", baseUnitsPerPack: 12 })).toBe(2.5);
    expect(recipeQuantityForEntry(5, "base", sack50)).toBe(5);
    expect(recipeQuantityForEntry(5, "pack", null)).toBeNull();
  });

  it("parses and formats decimal entry text without accepting garbage", () => {
    expect(parseRecipeQuantityInput("0.1")).toBe(0.1);
    expect(parseRecipeQuantityInput(".5")).toBe(0.5);
    expect(parseRecipeQuantityInput(" 2.50 ")).toBe(2.5);
    expect(parseRecipeQuantityInput("")).toBeNull();
    expect(parseRecipeQuantityInput(".")).toBeNull();
    expect(parseRecipeQuantityInput("0.")).toBe(0);
    expect(parseRecipeQuantityInput("5.")).toBe(5);
    expect(parseRecipeQuantityInput("1.2.3")).toBeNull();
    expect(parseRecipeQuantityInput("-1")).toBeNull();
    expect(parseRecipeQuantityInput("1e3")).toBeNull();
    expect(formatRecipeQuantityInput(5)).toBe("5");
    expect(formatRecipeQuantityInput(0.1 + 0.2)).toBe("0.3");
    expect(formatRecipeQuantityInput(null)).toBe("");
  });

  it("builds the canonical persisted line from a pack entry", () => {
    const line = buildRecipeLineFromEntry({
      ingredient: chicken,
      ingredientProductId: chicken.id,
      quantity: parseRecipeQuantityInput("0.5"),
      entryUnit: "pack",
    });
    expect(line).toEqual({ ingredientProductId: chicken.id, quantityBase: 5, unitLabel: "kg" });
  });

  it("drops zero, missing and invalid pack entries instead of saving bad quantities", () => {
    expect(
      buildRecipeLineFromEntry({
        ingredient: chicken,
        ingredientProductId: chicken.id,
        quantity: 0,
        entryUnit: "pack",
      }),
    ).toBeNull();
    expect(
      buildRecipeLineFromEntry({
        ingredient: undefined,
        ingredientProductId: chicken.id,
        quantity: 1,
        entryUnit: "base",
      }),
    ).toBeNull();
    expect(
      buildRecipeLineFromEntry({
        ingredient: product({ id: "bare", name: "Bare", baseUnit: "kg" }),
        ingredientProductId: "bare",
        quantity: 1,
        entryUnit: "pack",
      }),
    ).toBeNull();
  });

  it("leaves an existing base-unit recipe line meaning exactly the same", () => {
    const existing: RecipeLine = { ingredientProductId: oil.id, quantityBase: 0.6, unitLabel: "L" };
    const pack = recipePackUnitForIngredient(oil)!;
    expect(recipeQuantityToBase(existing.quantityBase, "base", pack)).toBe(0.6);
    expect(existing).toEqual({ ingredientProductId: oil.id, quantityBase: 0.6, unitLabel: "L" });
  });
});

function seed(products: Product[]) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    products,
    customers: [],
    sales: [],
    stockMovements: [],
    archivedStockMovements: [],
    voidRecords: [],
    archivedVoidRecords: [],
    returnRecords: [],
    archivedReturnRecords: [],
    auditLogs: [],
    archivedAuditLogs: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
  });
}

function packLine(ingredient: Product, quantityPack: number): RecipeLine {
  const pack = recipePackUnitForIngredient(ingredient);
  if (!pack) throw new Error("missing pack");
  const quantityBase = recipeQuantityToBase(quantityPack, "pack", pack);
  if (quantityBase == null) throw new Error("invalid conversion");
  return {
    ingredientProductId: ingredient.id,
    quantityBase,
    unitLabel: ingredient.baseUnit,
  };
}

function dishWith(lines: RecipeLine[], id = "dish-pack", yieldQty = 20): Product {
  return product({
    id,
    name: "Chicken + Chips",
    baseUnit: "portion",
    sellingPricePerUnitUgx: 15_000,
    costPricePerUnitUgx: 0,
    stockOnHand: 0,
    menu: {
      productKind: "finished_menu",
      prepMode: "batch_prepared",
      recipe: { yieldQty, lines },
      modifierGroups: [],
      variants: [],
    },
  });
}

const byId = (id: string) => usePosStore.getState().products.find((p) => p.id === id)!;

describe("batch preparation from buying-unit recipe entries", () => {
  beforeEach(() => {
    seed([
      { ...chicken },
      { ...potatoes },
      { ...oil },
      dishWith([packLine(chicken, 0.5), packLine(potatoes, 0.3), packLine(oil, 0.12)]),
    ]);
  });

  it("converts pack entries once and then deducts, costs and audits in base units", () => {
    const recipe = byId("dish-pack").menu!.recipe!;
    expect(recipe.lines.map((line) => line.quantityBase)).toEqual([5, 6, 0.6]);

    const result = usePosStore.getState().prepareMenuBatch({
      productId: "dish-pack",
      portions: 20,
      expectedPortions: 20,
      actualPortions: 20,
      batchId: "batch-pack",
    });
    expect(result).toEqual({ ok: true, batchId: "batch-pack" });

    // Same deductions as the base-unit Phase 5 fixture: 0.5 sack × 10,
    // 0.3 sack × 20, 0.12 jerrican × 5.
    expect(byId(chicken.id).stockOnHand).toBe(5);
    expect(byId(potatoes.id).stockOnHand).toBe(14);
    expect(byId(oil.id).stockOnHand).toBeCloseTo(4.4, 6);
    expect(byId("dish-pack").stockOnHand).toBe(20);

    const batch = byId("dish-pack").menu!.prepBatches![0]!;
    expect(batch.ingredientCostUgx).toBe(55_600);
    expect(batch.totalCostUgx).toBe(55_600);
    expect(batch.unitCostUgx).toBe(2_780);
    expect(batch.batchCostPerPlateUgx).toBe(2_780);
    expect(batch.recipeSnapshot?.lines.map((line) => line.quantityBase)).toEqual([5, 6, 0.6]);

    const moves = usePosStore.getState().stockMovements.filter((m) => m.refId === "batch-pack");
    expect(moves).toContainEqual(expect.objectContaining({ productId: chicken.id, deltaBaseUnits: -5 }));
    expect(moves).toContainEqual(expect.objectContaining({ productId: potatoes.id, deltaBaseUnits: -6 }));
    expect(moves.find((m) => m.productId === oil.id)!.deltaBaseUnits).toBeCloseTo(-0.6, 6);
    expect(moves).toContainEqual(
      expect.objectContaining({ productId: "dish-pack", deltaBaseUnits: 20 }),
    );
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "hospitality_prep_batch")).toBe(true);
  });
});

describe("existing base-unit recipes on pack-configured ingredients", () => {
  beforeEach(() => {
    seed([
      { ...chicken },
      dishWith([{ ingredientProductId: chicken.id, quantityBase: 0.5, unitLabel: "kg" }], "legacy-dish", 1),
    ]);
  });

  it("never multiplies a stored base quantity by the buying-unit rate", () => {
    // 0.5 kg must stay 0.5 kg even though the ingredient is configured as a 10 kg sack.
    const result = usePosStore.getState().prepareMenuBatch({
      productId: "legacy-dish",
      portions: 1,
      expectedPortions: 1,
      actualPortions: 1,
      batchId: "batch-legacy-pack",
    });
    expect(result.ok).toBe(true);
    expect(byId(chicken.id).stockOnHand).toBe(9.5);
    expect(byId("legacy-dish").menu!.prepBatches![0]!.recipeSnapshot?.lines[0]!.quantityBase).toBe(0.5);
  });
});
