import type { Product, Sale, UserRole } from "../types";
import { costPerBaseUnitUgx, estimatedProfitForLine } from "./sellingEngine";

/** Profit reports in Back Office — owners/managers only (not cashiers). */
export function canSeeOfficeProfit(role: UserRole, authMode: "supabase" | "local"): boolean {
  if (authMode === "local") return true;
  return role === "owner" || role === "manager";
}

/** @deprecated Use canSeeOfficeProfit — profit is not shown on cashier Home. */
export function canSeeHomeProfit(role: UserRole, authMode: "supabase" | "local"): boolean {
  return canSeeOfficeProfit(role, authMode);
}

export type ProfitProductRow = {
  productId: string;
  name: string;
  qty: number;
  salesUgx: number;
  costUgx: number;
  profitUgx: number;
};

export type ProfitCategoryGroup = {
  categoryKey: string;
  categoryLabel: string;
  products: ProfitProductRow[];
  salesUgx: number;
  costUgx: number;
  profitUgx: number;
};

export type ProfitGroupedReport = {
  groups: ProfitCategoryGroup[];
  total: TodayProfitBreakdown;
};

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

function uncategorizedLabel(): string {
  return "__uncategorized__";
}

/** Group profit by shelf/category, then by product name within each group. */
export function computeProfitGroupedByCategory(
  sales: Sale[],
  productById: Map<string, Product>,
  generalCategoryLabel: string,
): ProfitGroupedReport {
  const total = computeTodayProfitBreakdown(sales, productById);
  const byCategory = new Map<string, Map<string, ProfitProductRow>>();

  for (const sale of sales) {
    for (const line of sale.lines) {
      const product = productById.get(line.productId);
      const unitCost =
        Number.isFinite(line.unitCostUgx) && line.unitCostUgx >= 0
          ? line.unitCostUgx
          : product
            ? costPerBaseUnitUgx(product)
            : 0;
      const lineCost = Math.round(line.quantity * unitCost);
      const lineProfit = product
        ? estimatedProfitForLine(product, line)
        : Math.round(line.lineTotalUgx - lineCost);
      const catRaw = product?.category?.trim() ?? "";
      const categoryKey = catRaw.length > 0 ? catRaw : uncategorizedLabel();

      let catMap = byCategory.get(categoryKey);
      if (!catMap) {
        catMap = new Map();
        byCategory.set(categoryKey, catMap);
      }
      const pid = line.productId || line.name;
      const cur = catMap.get(pid) ?? {
        productId: line.productId,
        name: line.name,
        qty: 0,
        salesUgx: 0,
        costUgx: 0,
        profitUgx: 0,
      };
      catMap.set(pid, {
        ...cur,
        name: line.name || cur.name,
        qty: cur.qty + line.quantity,
        salesUgx: cur.salesUgx + line.lineTotalUgx,
        costUgx: cur.costUgx + lineCost,
        profitUgx: cur.profitUgx + lineProfit,
      });
    }
  }

  const groups: ProfitCategoryGroup[] = [...byCategory.entries()].map(([categoryKey, prodMap]) => {
    const products = [...prodMap.values()]
      .map((p) => ({
        ...p,
        salesUgx: Math.round(p.salesUgx),
        costUgx: Math.round(p.costUgx),
        profitUgx: Math.round(p.profitUgx),
      }))
      .sort((a, b) => b.profitUgx - a.profitUgx);
    const salesUgx = products.reduce((a, p) => a + p.salesUgx, 0);
    const costUgx = products.reduce((a, p) => a + p.costUgx, 0);
    const profitUgx = products.reduce((a, p) => a + p.profitUgx, 0);
    const categoryLabel =
      categoryKey === uncategorizedLabel() ? generalCategoryLabel : categoryKey;
    return { categoryKey, categoryLabel, products, salesUgx, costUgx, profitUgx };
  });

  groups.sort((a, b) => b.profitUgx - a.profitUgx);

  return { groups, total };
}
