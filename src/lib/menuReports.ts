import type { Product, Sale, SaleLineModifier } from "../types";
import { computeMenuItemMargin } from "./recipeEngine";

export type DishSaleStat = {
  productId: string;
  productName: string;
  quantitySold: number;
  revenueUgx: number;
  profitUgx: number;
};

export type ModifierPopularityStat = {
  optionLabel: string;
  groupLabel: string;
  count: number;
};

export type StationWorkloadStat = {
  stationType: string;
  ticketCount: number;
  itemCount: number;
};

export function aggregateDishSales(sales: Sale[]): DishSaleStat[] {
  const map = new Map<string, DishSaleStat>();
  for (const sale of sales) {
    if (sale.status === "pending" || sale.status === "cancelled") continue;
    for (const line of sale.lines) {
      if (line.voided) continue;
      const existing = map.get(line.productId) ?? {
        productId: line.productId,
        productName: line.name,
        quantitySold: 0,
        revenueUgx: 0,
        profitUgx: 0,
      };
      existing.quantitySold += line.quantity;
      existing.revenueUgx += line.lineTotalUgx;
      existing.profitUgx += line.estimatedProfitUgx ?? 0;
      map.set(line.productId, existing);
    }
  }
  return [...map.values()].sort((a, b) => b.revenueUgx - a.revenueUgx);
}

export function aggregateModifierPopularity(sales: Sale[]): ModifierPopularityStat[] {
  const map = new Map<string, ModifierPopularityStat>();
  for (const sale of sales) {
    if (sale.status === "pending" || sale.status === "cancelled") continue;
    for (const line of sale.lines) {
      if (line.voided) continue;
      for (const mod of line.selectedModifiers ?? []) {
        const key = `${mod.groupId}::${mod.optionId}`;
        const existing = map.get(key) ?? {
          optionLabel: mod.optionLabel,
          groupLabel: mod.groupLabel,
          count: 0,
        };
        existing.count += line.quantity;
        map.set(key, existing);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function lowMarginMenuItems(
  products: Product[],
  thresholdPct = 30,
): Array<{ product: Product; marginPct: number; foodCostUgx: number; sellPriceUgx: number }> {
  const out: Array<{ product: Product; marginPct: number; foodCostUgx: number; sellPriceUgx: number }> = [];
  for (const p of products) {
    if (!p.menu?.recipe && !p.menu?.modifierGroups?.length && p.menu?.productKind !== "finished_menu") continue;
    const m = computeMenuItemMargin(p, products);
    if (m.marginPct < thresholdPct) {
      out.push({ product: p, ...m });
    }
  }
  return out.sort((a, b) => a.marginPct - b.marginPct);
}

export function formatModifierSummary(modifiers: SaleLineModifier[]): string {
  if (!modifiers.length) return "";
  return modifiers.map((m) => m.optionLabel).join(", ");
}
