import type { IngredientShortage, Product, Recipe, RecipeLine, SaleLine, SaleLineModifier } from "../types";
import { productMenuConfig, resolveProductVariant } from "./menuModifiers";

export function effectiveRecipe(product: Product, variantId?: string | null): Recipe | null {
  const menu = productMenuConfig(product);
  const variant = resolveProductVariant(product, variantId);
  const recipe = variant?.recipe ?? menu?.recipe ?? null;
  if (!recipe?.lines?.length) return null;
  return recipe;
}

export function recipeLineQtyWithWaste(line: RecipeLine, sellQty: number, yieldQty = 1): number {
  const waste = Math.max(0, Math.min(100, line.wastePercent ?? 0));
  const base = (line.quantityBase * sellQty) / Math.max(1, yieldQty);
  return base * (1 + waste / 100);
}

export function aggregateRecipeRequirements(
  lines: Array<{
    product: Product;
    quantity: number;
    variantId?: string | null;
    modifiers?: SaleLineModifier[];
  }>,
): Map<string, number> {
  const totals = new Map<string, number>();

  const add = (productId: string, qty: number) => {
    if (qty <= 0) return;
    totals.set(productId, (totals.get(productId) ?? 0) + qty);
  };

  for (const row of lines) {
    const recipe = effectiveRecipe(row.product, row.variantId);
    const yieldQty = recipe?.yieldQty ?? 1;
    if (recipe) {
      for (const rl of recipe.lines) {
        add(rl.ingredientProductId, recipeLineQtyWithWaste(rl, row.quantity, yieldQty));
      }
    }
    for (const mod of row.modifiers ?? []) {
      const menu = productMenuConfig(row.product);
      const group = menu?.modifierGroups?.find((g) => g.id === mod.groupId);
      const opt = group?.options.find((o) => o.id === mod.optionId);
      if (opt?.ingredientProductId && opt.ingredientQtyBase) {
        add(opt.ingredientProductId, opt.ingredientQtyBase * row.quantity);
      }
    }
  }
  return totals;
}

export function checkIngredientAvailability(
  requirements: Map<string, number>,
  products: Product[],
): IngredientShortage[] {
  const shortages: IngredientShortage[] = [];
  for (const [ingredientId, required] of requirements) {
    const p = products.find((x) => x.id === ingredientId);
    if (!p) continue;
    const available = Math.max(0, p.stockOnHand);
    if (required > available + 1e-6) {
      shortages.push({
        ingredientProductId: ingredientId,
        ingredientName: p.name,
        requiredBase: required,
        availableBase: available,
        unitLabel: p.baseUnit || "ea",
      });
    }
  }
  return shortages;
}

export function requirementsFromSaleLines(lines: SaleLine[], products: Product[]): Map<string, number> {
  const rows = lines.map((line) => {
    const product = products.find((p) => p.id === line.productId);
    return product
      ? {
          product,
          quantity: line.quantity,
          variantId: line.variantId,
          modifiers: line.selectedModifiers,
        }
      : null;
  }).filter((x): x is NonNullable<typeof x> => x != null);
  return aggregateRecipeRequirements(rows);
}

export function computeRecipeFoodCostUgx(recipe: Recipe, products: Product[], sellQty = 1): number {
  const yieldQty = recipe.yieldQty ?? 1;
  let total = 0;
  for (const line of recipe.lines) {
    const ing = products.find((p) => p.id === line.ingredientProductId);
    if (!ing) continue;
    const qty = recipeLineQtyWithWaste(line, sellQty, yieldQty);
    total += qty * ing.costPricePerUnitUgx;
  }
  return Math.round(total);
}

export function computeMenuItemFoodCostUgx(product: Product, products: Product[], variantId?: string | null): number {
  const recipe = effectiveRecipe(product, variantId);
  if (recipe) return computeRecipeFoodCostUgx(recipe, products, 1);
  return Math.round(product.costPricePerUnitUgx);
}

export function computeMenuItemMargin(
  product: Product,
  products: Product[],
  variantId?: string | null,
): { foodCostUgx: number; sellPriceUgx: number; profitUgx: number; marginPct: number } {
  const variant = resolveProductVariant(product, variantId);
  const sellPriceUgx = variant?.priceUgx ?? product.sellingPricePerUnitUgx;
  const foodCostUgx = computeMenuItemFoodCostUgx(product, products, variantId);
  const profitUgx = sellPriceUgx - foodCostUgx;
  const marginPct = sellPriceUgx > 0 ? (profitUgx / sellPriceUgx) * 100 : 0;
  return { foodCostUgx, sellPriceUgx, profitUgx, marginPct };
}

export function shouldDeductFinishedProductStock(product: Product): boolean {
  const kind = productMenuConfig(product)?.productKind ?? "retail";
  if (kind === "ingredient") return true;
  if (kind === "finished_menu" && effectiveRecipe(product)) return false;
  return true;
}

export function applyRecipeStockDeduction(
  products: Product[],
  requirements: Map<string, number>,
): { products: Product[]; deducted: Array<{ productId: string; qty: number }> } {
  const next = products.map((p) => ({ ...p }));
  const deducted: Array<{ productId: string; qty: number }> = [];
  for (const [productId, qty] of requirements) {
    const idx = next.findIndex((p) => p.id === productId);
    if (idx === -1) continue;
    const p = next[idx]!;
    const delta = Math.min(p.stockOnHand, qty);
    if (delta <= 0) continue;
    next[idx] = {
      ...p,
      stockOnHand: Math.max(0, p.stockOnHand - delta),
      version: p.version + 1,
      updatedAt: new Date().toISOString(),
    };
    deducted.push({ productId, qty: delta });
  }
  return { products: next, deducted };
}
