import type { Product, ReturnRecord, Sale } from "../types";
import type { ProfitCategoryGroup, ProfitProductRow } from "./homeProfit";
import { computeTodayProfitBreakdown, mergeLinkedReturnsForScopedSales } from "./homeProfit";
import { dateKeyKampala } from "./datesUg";
import { formatUgx } from "./formatUgx";

export type ProfitProductView = ProfitProductRow & {
  shelfLabel: string;
  shelfKey: string;
  marginPct: number;
};

export type DailyProfitPoint = {
  dayKey: string;
  profitUgx: number;
  label: string;
};

export type ProfitQuickFilter =
  | "all"
  | "highest_profit"
  | "lowest_profit"
  | "loss_making"
  | "shelves"
  | "products";

export const LOW_MARGIN_THRESHOLD_PCT = 10;

export function marginPercent(salesUgx: number, profitUgx: number): number {
  if (salesUgx <= 0) return 0;
  return Math.round((profitUgx / salesUgx) * 1000) / 10;
}

/**
 * When closed-day authority overlays Revenue/Profit, derive Cost from the same
 * pair so Gross Profit = Revenue − Cost. Snapshot has no separate COGS field.
 * Live periods keep the sale-time COGS breakdown.
 */
export function resolveProfitHeadlineCostUgx(input: {
  closedPeriod: boolean;
  revenueUgx: number;
  profitUgx: number;
  liveCostUgx: number;
}): number {
  if (!input.closedPeriod) return input.liveCostUgx;
  return Math.round(input.revenueUgx - input.profitUgx);
}

/** Gross profit ÷ revenue-eligible transaction count (voids excluded from both). */
export function averageGrossProfitPerSale(grossProfitUgx: number, revenueEligibleTxnCount: number): number {
  if (revenueEligibleTxnCount <= 0) return 0;
  return Math.round(grossProfitUgx / revenueEligibleTxnCount);
}

export function averageSaleUgx(revenueUgx: number, revenueEligibleTxnCount: number): number {
  if (revenueEligibleTxnCount <= 0) return 0;
  return Math.round(revenueUgx / revenueEligibleTxnCount);
}

export function formatShortUgx(n: number): string {
  return formatUgx(n);
}

export function flattenProfitProducts(groups: ProfitCategoryGroup[]): ProfitProductView[] {
  const out: ProfitProductView[] = [];
  for (const g of groups) {
    for (const p of g.products) {
      if (p.qty <= 0 && p.salesUgx <= 0) continue;
      out.push({
        ...p,
        shelfLabel: g.categoryLabel,
        shelfKey: g.categoryKey,
        marginPct: marginPercent(p.salesUgx, p.profitUgx),
      });
    }
  }
  return out.sort((a, b) => b.profitUgx - a.profitUgx);
}

export function computeDailyProfitTrend(
  sales: Sale[],
  returns: ReturnRecord[],
  productById: Map<string, Product>,
  locale: string,
): DailyProfitPoint[] {
  const dayMap = new Map<string, Sale[]>();
  for (const s of sales) {
    const key = dateKeyKampala(s.createdAt);
    const bucket = dayMap.get(key);
    if (bucket) bucket.push(s);
    else dayMap.set(key, [s]);
  }
  const keys = [...dayMap.keys()].sort();
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "Africa/Kampala" });
  return keys.map((dayKey) => {
    const daySales = dayMap.get(dayKey) ?? [];
    const dayDatedReturns = returns.filter((r) => dateKeyKampala(r.createdAt) === dayKey);
    const dayReturns = mergeLinkedReturnsForScopedSales(daySales, dayDatedReturns, returns);
    const profitUgx = computeTodayProfitBreakdown(daySales, productById, dayReturns).profitUgx;
    const label = fmt.format(new Date(`${dayKey}T12:00:00`));
    return { dayKey, profitUgx, label };
  });
}

export function lastSoldAtForProduct(sales: Sale[], productId: string): string | null {
  let latest: string | null = null;
  for (const sale of sales) {
    for (const line of sale.lines) {
      if (line.voided || line.productId !== productId) continue;
      if (!latest || sale.createdAt > latest) latest = sale.createdAt;
    }
  }
  return latest;
}

export function productInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function shelfContributionPct(shelfProfit: number, totalProfit: number): number {
  if (totalProfit <= 0) return 0;
  return Math.round((shelfProfit / totalProfit) * 1000) / 10;
}

export function matchesProfitSearch(
  query: string,
  product: ProfitProductView,
  productRecord: Product | undefined,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (product.name.toLowerCase().includes(q)) return true;
  if (product.shelfLabel.toLowerCase().includes(q)) return true;
  const barcode = productRecord?.sku?.trim();
  if (barcode && barcode.toLowerCase().includes(q)) return true;
  return false;
}

export function matchesShelfSearch(query: string, shelfLabel: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return shelfLabel.toLowerCase().includes(q);
}
