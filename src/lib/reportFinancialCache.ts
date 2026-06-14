/**
 * Per-report-build cache for getCompletedFinancials — same outputs, fewer rescans.
 */

import type { Product, ReturnRecord, Sale } from "../types";
import {
  buildRevenueSalesIndex,
  getCompletedFinancials,
  type CompletedFinancialSnapshot,
  type RevenueSalesIndex,
} from "./financialMetrics";

export type ReportFinancialCache = {
  sales: Sale[];
  returns: ReturnRecord[];
  products: Product[];
  productById: Map<string, Product>;
  revenueIndex: RevenueSalesIndex;
  byDay: Map<string, CompletedFinancialSnapshot>;
  byMonth: Map<string, CompletedFinancialSnapshot>;
};

export function createReportFinancialCache(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
  revenueIndex?: RevenueSalesIndex,
): ReportFinancialCache {
  return {
    sales,
    returns,
    products,
    productById: new Map(products.map((p) => [p.id, p])),
    revenueIndex: revenueIndex ?? buildRevenueSalesIndex(sales, returns),
    byDay: new Map(),
    byMonth: new Map(),
  };
}

export function cachedCompletedFinancials(
  cache: ReportFinancialCache,
  opts?: { day?: string; monthKey?: string; skipProfit?: boolean },
): CompletedFinancialSnapshot {
  if (opts?.day) {
    const hit = cache.byDay.get(opts.day);
    if (hit && !opts.skipProfit) return hit;
    const fin = getCompletedFinancials(cache.sales, cache.returns, cache.products, opts, cache.revenueIndex);
    if (!opts.skipProfit) cache.byDay.set(opts.day, fin);
    return fin;
  }
  if (opts?.monthKey) {
    const hit = cache.byMonth.get(opts.monthKey);
    if (hit && !opts.skipProfit) return hit;
    const fin = getCompletedFinancials(cache.sales, cache.returns, cache.products, opts, cache.revenueIndex);
    if (!opts.skipProfit) cache.byMonth.set(opts.monthKey, fin);
    return fin;
  }
  return getCompletedFinancials(cache.sales, cache.returns, cache.products, opts, cache.revenueIndex);
}

/** Sales in filter bounds using pre-built day index when possible. */
export function cachedSalesForDay(cache: ReportFinancialCache, dayKey: string): Sale[] {
  return cache.revenueIndex.salesByDay.get(dayKey) ?? [];
}

/** Returns in filter bounds using pre-built day index when possible. */
export function cachedReturnsForDay(cache: ReportFinancialCache, dayKey: string): ReturnRecord[] {
  return cache.revenueIndex.returnsByDay.get(dayKey) ?? [];
}
