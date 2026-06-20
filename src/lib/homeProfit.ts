import type { Product, ReturnRecord, Sale, UserRole } from "../types";
import { computeCanonicalRevenueUgx } from "./canonicalRevenue";
import { costPerBaseUnitUgx, estimatedProfitForLine } from "./sellingEngine";
import { lineCostForProductQuantity, lineCostFromSaleLine, lineProfitUgx } from "./costPrecision";

/** @deprecated Use resolveProfitVisibility().canProfit — role-only gate without subscription tier. */
export function canSeeOfficeProfit(role: UserRole, authMode: "supabase" | "local"): boolean {
  if (authMode === "local") return role === "owner" || role === "manager" || role === "supervisor";
  return role === "owner" || role === "manager" || role === "supervisor";
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
  returnRecords: ReturnRecord[] = [],
): TodayProfitBreakdown {
  let salesUgx = 0;
  let costUgx = 0;
  let profitUgx = 0;
  let linesMissingCost = 0;

  for (const sale of todaySales) {
    for (const line of sale.lines) {
      if (line.voided) continue;
      const product = productById.get(line.productId);
      const unitCost =
        Number.isFinite(line.unitCostUgx) && line.unitCostUgx >= 0
          ? line.unitCostUgx
          : product
            ? costPerBaseUnitUgx(product)
            : 0;
      if (unitCost <= 0) linesMissingCost += 1;
      const lineCost = lineCostFromSaleLine(line);
      costUgx += lineCost;
      profitUgx += product
        ? estimatedProfitForLine(product, line)
        : Math.round(line.lineTotalUgx - lineCost);
    }
  }

  for (const rec of returnRecords) {
    const refundUgx = Math.max(0, Math.floor(rec.refundAmountUgx));
    const qty = Math.max(0, rec.quantity);
    if (refundUgx <= 0 || qty <= 0) continue;
    const product = productById.get(rec.productId);
    const returnUnitCost = product ? costPerBaseUnitUgx(product) : 0;
    if (returnUnitCost <= 0) linesMissingCost += 1;
    const returnCost = product
      ? lineCostForProductQuantity(product, qty, returnUnitCost)
      : Math.round(qty * returnUnitCost);
    salesUgx -= refundUgx;
    costUgx -= returnCost;
    profitUgx -= lineProfitUgx(refundUgx, returnCost);
  }

  salesUgx = computeCanonicalRevenueUgx(todaySales, returnRecords);

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
  returnRecords: ReturnRecord[] = [],
): ProfitGroupedReport {
  const total = computeTodayProfitBreakdown(sales, productById, returnRecords);
  const byCategory = new Map<string, Map<string, ProfitProductRow>>();

  for (const sale of sales) {
    for (const line of sale.lines) {
      if (line.voided) continue;
      const product = productById.get(line.productId);
      const lineCost = lineCostFromSaleLine(line);
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

  for (const rec of returnRecords) {
    const product = productById.get(rec.productId);
    const qty = Math.max(0, rec.quantity);
    const refundUgx = Math.max(0, Math.floor(rec.refundAmountUgx));
    if (qty <= 0 || refundUgx <= 0) continue;
    const returnUnitCost = product ? costPerBaseUnitUgx(product) : 0;
    const returnCost = product
      ? lineCostForProductQuantity(product, qty, returnUnitCost)
      : Math.round(qty * returnUnitCost);
    const returnProfitImpact = lineProfitUgx(refundUgx, returnCost);
    const catRaw = product?.category?.trim() ?? "";
    const categoryKey = catRaw.length > 0 ? catRaw : uncategorizedLabel();
    let catMap = byCategory.get(categoryKey);
    if (!catMap) {
      catMap = new Map();
      byCategory.set(categoryKey, catMap);
    }
    const pid = rec.productId;
    const cur = catMap.get(pid) ?? {
      productId: rec.productId,
      name: rec.productName,
      qty: 0,
      salesUgx: 0,
      costUgx: 0,
      profitUgx: 0,
    };
    catMap.set(pid, {
      ...cur,
      name: rec.productName || cur.name,
      qty: cur.qty - qty,
      salesUgx: cur.salesUgx - refundUgx,
      costUgx: cur.costUgx - returnCost,
      profitUgx: cur.profitUgx - returnProfitImpact,
    });
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
