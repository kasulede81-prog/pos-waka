import type { IngredientShortage, PrepBatch, PrepRecipeSnapshot, Product, Recipe, RecipeLine, SaleLine, SaleLineModifier } from "../types";
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

// ─── Phase 5 — batch preparation ─────────────────────────────────────────────

/** Explicit preparation mode (audit correction): never inferred from stock levels. */
export function productPrepMode(product: Product): "made_to_order" | "batch_prepared" {
  return productMenuConfig(product)?.prepMode ?? "made_to_order";
}

/** Active batches with portions remaining, FIFO by preparedAt. */
export function activePrepBatches(product: Product): PrepBatch[] {
  const batches = productMenuConfig(product)?.prepBatches ?? [];
  return batches
    .filter((b) => b.status === "active" && b.remainingPortions > 0.0001)
    .sort((a, b) => a.preparedAt.localeCompare(b.preparedAt));
}

export function preparedPortionsAvailable(product: Product): number {
  return activePrepBatches(product).reduce((sum, b) => sum + b.remainingPortions, 0);
}

/** Ingredient requirement map for preparing `portions` portions of a dish. */
export function prepRequirementsForPortions(product: Product, portions: number): Map<string, number> {
  return aggregateRecipeRequirements([{ product, quantity: portions }]);
}

/** Historical per-portion recipe cost at preparation time (frozen on the batch). */
export function prepBatchUnitCostUgx(product: Product, products: Product[]): number {
  return computeMenuItemFoodCostUgx(product, products);
}

/**
 * True when a sale of this product deducts raw ingredients at sale time
 * (Phase 4 made-to-order behavior). Batch-prepared recipe items do NOT —
 * their ingredients were consumed at preparation time.
 */
export function saleLineConsumesIngredientsAtSale(product: Product): boolean {
  return effectiveRecipe(product) != null && productPrepMode(product) !== "batch_prepared";
}

/**
 * FIFO consumption plan for selling `portions` prepared portions.
 * Returns the full (re-ordered, updated) batch list with remainingPortions
 * decremented oldest-first, the weighted historical unit cost, and the exact
 * per-batch allocation (frozen onto the SaleLine as provenance), or an error
 * when prepared stock is insufficient.
 */
export function planPrepBatchConsumption(
  product: Product,
  portions: number,
  at: string,
):
  | {
      ok: true;
      batches: PrepBatch[];
      unitCostUgx: number;
      allocation: Array<{ batchId: string; portions: number }>;
    }
  | { ok: false; errorKey: "insufficientPreparedStock" } {
  const all = (productMenuConfig(product)?.prepBatches ?? []).map((b) => ({ ...b }));
  const total = preparedPortionsAvailable(product);
  if (portions > total + 0.0001) return { ok: false, errorKey: "insufficientPreparedStock" };

  let remaining = portions;
  let cost = 0;
  const allocation: Array<{ batchId: string; portions: number }> = [];
  for (const batch of activePrepBatches(product)) {
    if (remaining <= 0.0001) break;
    const take = Math.min(batch.remainingPortions, remaining);
    cost += take * batch.unitCostUgx;
    remaining -= take;
    allocation.push({ batchId: batch.id, portions: Math.round(take * 10000) / 10000 });
    const idx = all.findIndex((b) => b.id === batch.id);
    if (idx === -1) continue;
    const nextRemaining = Math.round((batch.remainingPortions - take) * 10000) / 10000;
    all[idx] = {
      ...all[idx]!,
      remainingPortions: nextRemaining,
      status: nextRemaining <= 0.0001 ? "depleted" : "active",
      updatedAt: at,
      version: (all[idx]!.version ?? 1) + 1,
    };
  }
  return { ok: true, batches: all, unitCostUgx: Math.round(cost / portions), allocation };
}

/**
 * Phase 5.1 — ingredient requirements attributable to `portions` portions of a
 * batch, computed from the IMMUTABLE preparation-time recipe snapshot (ratios,
 * yield, and waste frozen at prep). Used by cancellation so a later recipe
 * edit never changes what a cancel restores.
 */
export function prepSnapshotRequirements(snapshot: PrepRecipeSnapshot, portions: number): Map<string, number> {
  const yieldQty = snapshot.yieldQty ?? 1;
  const totals = new Map<string, number>();
  for (const line of snapshot.lines) {
    const qty = recipeLineQtyWithWaste(line, portions, yieldQty);
    if (qty <= 0) continue;
    totals.set(line.ingredientProductId, (totals.get(line.ingredientProductId) ?? 0) + qty);
  }
  return totals;
}

/**
 * Phase 5.1 — void support: credit each batch in a SaleLine's frozen
 * prepAllocation back by its exact consumed portions. Batches not found in
 * the product (e.g. cleaned-up history) are skipped. Returns the updated
 * product, or null when nothing matched.
 */
export function creditPrepAllocation(
  product: Product,
  allocation: Array<{ batchId: string; portions: number }>,
  at: string,
): Product | null {
  const batches = product.menu?.prepBatches ?? [];
  if (!batches.length || !allocation.length) return null;
  let touched = false;
  const next = batches.map((b) => {
    const credit = allocation.find((a) => a.batchId === b.id);
    if (!credit || credit.portions <= 0) return b;
    if (b.status === "cancelled" || b.status === "wasted") return b;
    touched = true;
    return {
      ...b,
      remainingPortions: Math.round((b.remainingPortions + credit.portions) * 10000) / 10000,
      status: "active" as const,
      updatedAt: at,
      version: (b.version ?? 1) + 1,
      pendingSync: true,
    };
  });
  if (!touched) return null;
  return { ...product, menu: { ...product.menu, prepBatches: next } };
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
