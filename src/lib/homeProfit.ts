import type { Product, Sale, UserRole } from "../types";
import { costPerBaseUnitUgx, estimatedProfitForLine } from "./sellingEngine";

/** Today's profit on Home — owners/managers always; not gated by Business plan. */
export function canSeeHomeProfit(role: UserRole, authMode: "supabase" | "local"): boolean {
  if (authMode === "local") return true;
  return role === "owner" || role === "manager";
}

export type TodayProfitBreakdown = {
  profitUgx: number;
  salesUgx: number;
  costUgx: number;
  linesMissingCost: number;
};

/** Profit per line = sale amount − (buying cost per unit × quantity sold). */
export function computeTodayProfitBreakdown(
  todaySales: Sale[],
  productById: Map<string, Product>,
): TodayProfitBreakdown {
  let salesUgx = 0;
  let costUgx = 0;
  let profitUgx = 0;
  let linesMissingCost = 0;

  for (const sale of todaySales) {
    for (const line of sale.lines) {
      salesUgx += line.lineTotalUgx;
      const product = productById.get(line.productId);
      const unitCost =
        Number.isFinite(line.unitCostUgx) && line.unitCostUgx >= 0
          ? line.unitCostUgx
          : product
            ? costPerBaseUnitUgx(product)
            : 0;
      if (unitCost <= 0) linesMissingCost += 1;
      const lineCost = Math.round(line.quantity * unitCost);
      costUgx += lineCost;
      profitUgx += product
        ? estimatedProfitForLine(product, line)
        : Math.round(line.lineTotalUgx - lineCost);
    }
  }

  return {
    profitUgx: Math.round(profitUgx),
    salesUgx: Math.round(salesUgx),
    costUgx: Math.round(costUgx),
    linesMissingCost,
  };
}
