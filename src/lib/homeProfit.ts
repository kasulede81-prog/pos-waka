import type { Product, ReturnRecord, Sale, UserRole } from "../types";
import { computeCanonicalRevenueUgx } from "./canonicalRevenue";
import { normalizeUnitCostUgx } from "./costPrecision";
import {
  findSaleLineForReturn,
  resolveReturnFinancials,
  resolveSaleLineFinancialsWithSale,
  sumSaleLinesFinancials,
} from "./saleFinancialEngine";

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
  /** True when any active line lacks trustworthy historical unit cost (zero COGS is not assumed known). */
  costIncomplete: boolean;
};

/**
 * Sale-line historical cost is trustworthy for Profit only when unit cost &gt; 0.
 * Zero/missing unit cost is treated as cost-incomplete (may silently inflate gross profit).
 * Does not consult live WAC / product catalog.
 */
export function saleLineHasTrustworthyHistoricalCost(line: {
  voided?: boolean | null;
  unitCostUgx?: number | null;
  financialDataStatus?: string | null;
}): boolean {
  if (line.voided) return true;
  if (line.financialDataStatus === "legacy" || line.financialDataStatus === "needs_repair") {
    return false;
  }
  return normalizeUnitCostUgx(line.unitCostUgx) > 0;
}

/**
 * Linked returns already reduce sale.totalUgx (canonical revenue).
 * When the sale is in profit scope but the return falls outside the date filter,
 * still include that return for COGS/profit so Revenue − COGS ≈ Gross Profit.
 * Idempotent by return id — does not double-count same-day returns.
 */
export function mergeLinkedReturnsForScopedSales(
  scopedSales: Sale[],
  dateScopedReturns: ReturnRecord[],
  allReturns: ReturnRecord[],
): ReturnRecord[] {
  const saleIds = new Set(scopedSales.map((s) => s.id));
  const byId = new Map<string, ReturnRecord>();
  for (const rec of dateScopedReturns) {
    byId.set(rec.id, rec);
  }
  for (const rec of allReturns) {
    const sid = rec.saleId?.trim();
    if (!sid || !saleIds.has(sid)) continue;
    byId.set(rec.id, rec);
  }
  return [...byId.values()];
}

/** Profit per line = sale amount − (buying cost per unit × quantity sold). */
export function computeTodayProfitBreakdown(
  todaySales: Sale[],
  _productById: Map<string, Product>,
  returnRecords: ReturnRecord[] = [],
): TodayProfitBreakdown {
  let salesUgx = 0;
  let costUgx = 0;
  let profitUgx = 0;
  let linesMissingCost = 0;

  for (const sale of todaySales) {
    const active = sale.lines.filter((l) => !l.voided);
    const lineSubtotalUgx = active.reduce((a, l) => a + l.lineTotalUgx, 0);
    const heldTotal = Math.max(0, Math.floor(sale.totalUgx ?? 0));
    const cartDiscountUgx = Math.max(0, Math.min(lineSubtotalUgx, lineSubtotalUgx - heldTotal));
    const saleContext = { cartDiscountUgx, lineSubtotalUgx };
    const part = sumSaleLinesFinancials(active, saleContext);
    costUgx += part.cogsUgx;
    profitUgx += part.grossProfitUgx;
    for (const line of active) {
      if (!saleLineHasTrustworthyHistoricalCost(line)) linesMissingCost += 1;
    }
  }

  for (const rec of returnRecords) {
    const refundUgx = Math.max(0, Math.floor(rec.refundAmountUgx));
    const qty = Math.max(0, rec.quantity);
    if (refundUgx <= 0 || qty <= 0) continue;
    const linkedSale = todaySales.find((s) => s.id === rec.saleId);
    const saleLine = findSaleLineForReturn(linkedSale, rec.productId);
    const retFin = resolveReturnFinancials(rec, saleLine);
    if (!saleLineHasTrustworthyHistoricalCost({ unitCostUgx: retFin.unitCostUgx })) {
      linesMissingCost += 1;
    }
    salesUgx -= refundUgx;
    costUgx -= retFin.cogsUgx;
    profitUgx -= retFin.grossProfitUgx;
  }

  salesUgx = computeCanonicalRevenueUgx(todaySales, returnRecords);

  return {
    profitUgx: Math.round(profitUgx),
    salesUgx: Math.round(salesUgx),
    costUgx: Math.round(costUgx),
    linesMissingCost,
    costIncomplete: linesMissingCost > 0,
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
      const fin = resolveSaleLineFinancialsWithSale(line, sale);
      const catRaw = productById.get(line.productId)?.category?.trim() ?? "";
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
        salesUgx: cur.salesUgx + fin.revenueUgx,
        costUgx: cur.costUgx + fin.cogsUgx,
        profitUgx: cur.profitUgx + fin.grossProfitUgx,
      });
    }
  }

  for (const rec of returnRecords) {
    const product = productById.get(rec.productId);
    const qty = Math.max(0, rec.quantity);
    const refundUgx = Math.max(0, Math.floor(rec.refundAmountUgx));
    if (qty <= 0 || refundUgx <= 0) continue;
    const linkedSale = sales.find((s) => s.id === rec.saleId);
    const saleLine = findSaleLineForReturn(linkedSale, rec.productId);
    const retFin = resolveReturnFinancials(rec, saleLine);
    const returnProfitImpact = retFin.grossProfitUgx;
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
      costUgx: cur.costUgx - retFin.cogsUgx,
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
