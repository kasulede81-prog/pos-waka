/**
 * Recipe quantity entry in the ingredient's configured buying unit.
 *
 * The stored recipe line remains canonical: `quantityBase` is always in the
 * ingredient's base stock unit. This module converts ONLY at the editor
 * boundary, reusing the product's existing `buyingUnit` + `conversionRate`
 * model (base units per buying unit, as used by purchases and pack costing).
 * It never rewrites existing `quantityBase` values.
 */
import type { Product, RecipeLine } from "../types";
import { packLabelFromProduct } from "./sellingEngine";

export type RecipeEntryUnit = "base" | "pack";

export type RecipePackUnit = {
  /** Human label from `buyingUnit` (supplier suffix removed). */
  label: string;
  /** The ingredient's canonical stock unit. */
  baseUnit: string;
  /** Base stock units contained in one buying unit. */
  baseUnitsPerPack: number;
};

const QUANTITY_DECIMALS = 6;
const QUANTITY_FACTOR = 10 ** QUANTITY_DECIMALS;

/** Trim floating-point noise without changing meaningful fractions. */
export function roundRecipeQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * QUANTITY_FACTOR) / QUANTITY_FACTOR;
}

/**
 * The usable buying unit for recipe entry, or null when the product has no
 * conversion. Missing / zero / negative / non-finite rates are rejected rather
 * than treated as 1 — a bad rate must not silently multiply or divide a recipe.
 */
export function recipePackUnitForIngredient(ingredient: Product): RecipePackUnit | null {
  const label = packLabelFromProduct(ingredient);
  if (!label) return null;
  const rate = Number(ingredient.conversionRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    label,
    baseUnit: ingredient.baseUnit?.trim() || "ea",
    baseUnitsPerPack: rate,
  };
}

/**
 * Convert a quantity typed in `entryUnit` into canonical base units.
 * Returns null for invalid input (NaN/Infinity/negative quantity, no usable
 * pack) so callers can fail safely instead of persisting NaN or Infinity.
 * A zero quantity is valid and returns 0.
 */
export function recipeQuantityToBase(
  quantity: number,
  entryUnit: RecipeEntryUnit,
  pack: RecipePackUnit | null,
): number | null {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 0) return null;
  if (entryUnit === "base") return qty;
  if (qty === 0) return 0;
  if (!pack) return null;
  const rate = pack.baseUnitsPerPack;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const base = qty * rate;
  if (!Number.isFinite(base)) return null;
  return roundRecipeQuantity(base);
}

/**
 * Display a canonical base quantity in the selected entry unit. Used when the
 * user switches units without editing the value; the underlying base quantity
 * is never changed by a unit switch.
 */
export function recipeQuantityForEntry(
  quantityBase: number,
  entryUnit: RecipeEntryUnit,
  pack: RecipePackUnit | null,
): number | null {
  const base = Number(quantityBase);
  if (!Number.isFinite(base) || base < 0) return null;
  if (entryUnit === "base") return base;
  if (!pack) return null;
  const rate = pack.baseUnitsPerPack;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const qty = base / rate;
  if (!Number.isFinite(qty)) return null;
  return roundRecipeQuantity(qty);
}

/** Plain decimal text for a controlled quantity input (no trailing zeros). */
export function formatRecipeQuantityInput(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(roundRecipeQuantity(value));
}

/**
 * Parse a typed decimal. Rejects scientific notation, signs, and multiple dots;
 * returns null while the text is not yet a number ("", "."). A trailing dot
 * ("5.") is valid so a just-typed decimal point is not lost as zero.
 */
export function parseRecipeQuantityInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Build the canonical persisted line for the add-item sheet. Returns null for
 * an unselected ingredient or a non-positive converted quantity, matching the
 * existing filter (empty lines are dropped, never saved as 0).
 */
export function buildRecipeLineFromEntry(input: {
  ingredient: Product | undefined;
  ingredientProductId: string;
  quantity: number | null;
  entryUnit: RecipeEntryUnit;
}): RecipeLine | null {
  const { ingredient, ingredientProductId, quantity, entryUnit } = input;
  if (!ingredient || !ingredientProductId || quantity == null) return null;
  const base = recipeQuantityToBase(
    quantity,
    entryUnit,
    recipePackUnitForIngredient(ingredient),
  );
  if (base == null || base <= 0) return null;
  return {
    ingredientProductId,
    quantityBase: base,
    unitLabel: ingredient.baseUnit?.trim() || "ea",
  };
}
