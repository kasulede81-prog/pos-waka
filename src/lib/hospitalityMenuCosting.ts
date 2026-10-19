import type { Product } from "../types";
import {
  computeMenuItemMargin,
  effectiveRecipe,
  missingRecipeIngredientIds,
} from "./recipeEngine";

/** Categories used by the Uganda starter packs and common food shelves. */
const FOOD_CATEGORY_RE = /(food|main|meal|chicken|pork|fish|goat|rice|chips|dessert|breakfast|snack|kitchen)/i;

/** Any non-ingredient product shown on the Hospitality menu. */
export function isHospitalityMenuItem(product: Product): boolean {
  const kind = product.menu?.productKind ?? "retail";
  return kind !== "ingredient" && kind !== "semi_finished";
}

/**
 * A dish that should be costed from a recipe: marked finished_menu, already has
 * a recipe, or sits on a known food category. Purchased drinks/resale items are
 * deliberately excluded and use their shared product cost instead.
 */
export function isHospitalityRecipeDish(product: Product): boolean {
  if (!isHospitalityMenuItem(product)) return false;
  const kind = product.menu?.productKind ?? "retail";
  if (kind === "finished_menu") return true;
  if (effectiveRecipe(product)) return true;
  return FOOD_CATEGORY_RE.test(product.category?.trim() ?? "");
}

/** A purchased/resale menu item, not a recipe dish. */
export function isHospitalityResaleItem(product: Product): boolean {
  return isHospitalityMenuItem(product) && !isHospitalityRecipeDish(product);
}

/** Ingredient ids in the recipe that exist but have no cost price set. */
export function zeroCostRecipeIngredientIds(product: Product, products: Product[]): string[] {
  const recipe = effectiveRecipe(product);
  if (!recipe) return [];
  const ids = new Set<string>();
  for (const line of recipe.lines) {
    if (!line.ingredientProductId) continue;
    const ingredient = products.find((p) => p.id === line.ingredientProductId);
    if (!ingredient) continue; // missing references are reported separately
    if (!(ingredient.costPricePerUnitUgx > 0)) ids.add(line.ingredientProductId);
  }
  return [...ids];
}

export type TrustedProductCost = {
  costUgx: number;
  source: "manual" | "purchase";
};

/** Current shared product cost, only when provenance makes it trustworthy. */
export function resolveTrustedProductCost(
  product: Pick<Product, "costPricePerUnitUgx" | "costSource">,
): TrustedProductCost | null {
  const costUgx = Number(product.costPricePerUnitUgx) || 0;
  if (costUgx <= 0) return null;
  if (product.costSource !== "manual" && product.costSource !== "purchase") return null;
  return { costUgx, source: product.costSource };
}

export type HospitalityMenuCostState =
  | {
      status: "not_set";
      missingIngredientIds: string[];
    }
  | {
      status: "estimated";
      foodCostUgx: number;
      sellPriceUgx: number;
      profitUgx: number;
      marginPct: number;
      missingIngredientIds: string[];
      zeroCostIngredientIds: string[];
      /** True when the recipe cannot produce a trustworthy margin yet. */
      incomplete: boolean;
    }
  | {
      /** A purchased/resale item whose shared product cost has verified provenance. */
      status: "verified_product_cost";
      costSource: "manual" | "purchase";
      foodCostUgx: number;
      sellPriceUgx: number;
      profitUgx: number;
      marginPct: number;
    }
  | {
      /**
       * A resale item with no verifiable cost. `quick_add_default` is the 72%
       * generated fallback; `unknown` is an older row with no provenance.
       */
      status: "unverified_product_cost";
      reason: "quick_add_default" | "unknown" | "not_set";
    };

/**
 * One honest answer to "what cost can this Hospitality menu item show?".
 *
 * - Recipe dish: not set / incomplete / estimated from recipe.
 * - Resale item: the shared product cost, but only when provenance is a
 *   supplier purchase or an explicit merchant edit. A generated quick-add
 *   default is never presented as verified cost.
 */
export function hospitalityMenuCostState(
  product: Product,
  products: Product[],
): HospitalityMenuCostState {
  const recipe = effectiveRecipe(product);
  if (recipe) {
    const missingIngredientIds = missingRecipeIngredientIds(product, products);
    const zeroCostIngredientIds = zeroCostRecipeIngredientIds(product, products);
    const margin = computeMenuItemMargin(product, products);
    return {
      status: "estimated",
      ...margin,
      missingIngredientIds,
      zeroCostIngredientIds,
      incomplete: missingIngredientIds.length > 0 || zeroCostIngredientIds.length > 0,
    };
  }

  if (isHospitalityRecipeDish(product)) {
    return { status: "not_set", missingIngredientIds: [] };
  }

  const trusted = resolveTrustedProductCost(product);
  if (trusted) {
    const foodCostUgx = Math.round(trusted.costUgx);
    const sellPriceUgx = product.sellingPricePerUnitUgx;
    const profitUgx = sellPriceUgx - foodCostUgx;
    return {
      status: "verified_product_cost",
      costSource: trusted.source,
      foodCostUgx,
      sellPriceUgx,
      profitUgx,
      marginPct: sellPriceUgx > 0 ? (profitUgx / sellPriceUgx) * 100 : 0,
    };
  }

  const cost = Number(product.costPricePerUnitUgx) || 0;
  const source = product.costSource;
  return {
    status: "unverified_product_cost",
    reason:
      source === "quick_add_default"
        ? "quick_add_default"
        : cost <= 0
          ? "not_set"
          : "unknown",
  };
}
