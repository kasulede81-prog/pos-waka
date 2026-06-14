/**
 * Canonical financial metrics for dashboards and reports.
 * Revenue counts only completed sales — never pending/cancelled/open bills.
 */

import type { Product, ReturnRecord, Sale } from "../types";
import { dateKeyKampala, saleReportingDayKey } from "./datesUg";
import { computeCanonicalRevenueUgx } from "./canonicalRevenue";
import { computeTodayProfitBreakdown } from "./homeProfit";
import { isCompletedSale } from "./saleStatus";

/** Pre-index revenue sales and returns by Kampala day — one pass, identical scoped results. */
export type RevenueSalesIndex = {
  salesByDay: Map<string, Sale[]>;
  returnsByDay: Map<string, ReturnRecord[]>;
};

export function buildRevenueSalesIndex(sales: Sale[], returns: ReturnRecord[]): RevenueSalesIndex {
  const salesByDay = new Map<string, Sale[]>();
  for (const s of sales) {
    if (!isCompletedSale(s)) continue;
    const dk = saleReportingDayKey(s);
    const bucket = salesByDay.get(dk);
    if (bucket) bucket.push(s);
    else salesByDay.set(dk, [s]);
  }
  const returnsByDay = new Map<string, ReturnRecord[]>();
  for (const r of returns) {
    const dk = dateKeyKampala(r.createdAt);
    const bucket = returnsByDay.get(dk);
    if (bucket) bucket.push(r);
    else returnsByDay.set(dk, [r]);
  }
  return { salesByDay, returnsByDay };
}

function scopedSalesFromIndex(
  sales: Sale[],
  index: RevenueSalesIndex | undefined,
  opts?: { day?: string; monthKey?: string },
): Sale[] {
  if (index && opts?.day) return index.salesByDay.get(opts.day) ?? [];
  if (index && opts?.monthKey) {
    const out: Sale[] = [];
    for (const [dk, list] of index.salesByDay) {
      if (dk.startsWith(opts.monthKey)) out.push(...list);
    }
    return out;
  }
  let scoped = revenueSales(sales);
  if (opts?.day) scoped = scoped.filter((s) => saleReportingDayKey(s) === opts.day);
  else if (opts?.monthKey) scoped = scoped.filter((s) => saleReportingDayKey(s).startsWith(opts.monthKey!));
  return scoped;
}

function scopedReturnsFromIndex(
  returns: ReturnRecord[],
  index: RevenueSalesIndex | undefined,
  opts?: { day?: string; monthKey?: string },
): ReturnRecord[] {
  if (index && opts?.day) return index.returnsByDay.get(opts.day) ?? [];
  if (index && opts?.monthKey) {
    const out: ReturnRecord[] = [];
    for (const [dk, list] of index.returnsByDay) {
      if (dk.startsWith(opts.monthKey)) out.push(...list);
    }
    return out;
  }
  if (opts?.day) return returns.filter((r) => dateKeyKampala(r.createdAt) === opts.day);
  if (opts?.monthKey) return returns.filter((r) => dateKeyKampala(r.createdAt).startsWith(opts.monthKey!));
  return returns;
}

/** Sales that count toward revenue (completed only). */
export function isRevenueSale(s: Sale): boolean {
  return isCompletedSale(s);
}

export function revenueSales(sales: Sale[]): Sale[] {
  return sales.filter(isRevenueSale);
}

export function revenueSalesOnDay(sales: Sale[], day: string): Sale[] {
  return revenueSales(sales).filter((s) => saleReportingDayKey(s) === day);
}

export function revenueSalesInMonth(sales: Sale[], monthKey: string): Sale[] {
  return revenueSales(sales).filter((s) => saleReportingDayKey(s).startsWith(monthKey));
}

export type CompletedFinancialSnapshot = {
  revenueUgx: number;
  profitUgx: number;
  transactionCount: number;
  cashCollectedUgx: number;
  debtIssuedUgx: number;
  discountsUgx: number;
  averageTransactionUgx: number;
};

export function getCompletedFinancialsFromScoped(
  scoped: Sale[],
  returnScoped: ReturnRecord[],
  products: Product[],
  opts?: { skipProfit?: boolean },
): CompletedFinancialSnapshot {
  const productById = new Map(products.map((p) => [p.id, p]));
  const breakdown = opts?.skipProfit
    ? { profitUgx: 0, salesUgx: 0, costUgx: 0, linesMissingCost: 0 }
    : computeTodayProfitBreakdown(scoped, productById, returnScoped);
  const tx = scoped.length;
  const revenue = computeCanonicalRevenueUgx(scoped, returnScoped);

  let cashCollectedUgx = 0;
  let debtIssuedUgx = 0;
  let discountsUgx = 0;
  for (const s of scoped) {
    cashCollectedUgx += s.cashPaidUgx;
    debtIssuedUgx += s.debtUgx;
    discountsUgx += s.discountTotalUgx ?? 0;
  }

  return {
    revenueUgx: revenue,
    profitUgx: breakdown.profitUgx,
    transactionCount: tx,
    cashCollectedUgx,
    debtIssuedUgx,
    discountsUgx,
    averageTransactionUgx: tx > 0 ? Math.round(revenue / tx) : 0,
  };
}

export function getCompletedFinancials(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
  opts?: { day?: string; monthKey?: string; skipProfit?: boolean },
  index?: RevenueSalesIndex,
): CompletedFinancialSnapshot {
  const scoped = scopedSalesFromIndex(sales, index, opts);
  const returnScoped = scopedReturnsFromIndex(returns, index, opts);
  return getCompletedFinancialsFromScoped(scoped, returnScoped, products, opts);
}

export function getCompletedRevenue(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
  day?: string,
): number {
  return getCompletedFinancials(sales, returns, products, day ? { day } : undefined).revenueUgx;
}

export function getCompletedProfit(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
  day?: string,
): number {
  return getCompletedFinancials(sales, returns, products, day ? { day } : undefined).profitUgx;
}

export function getCompletedSalesCount(sales: Sale[], day?: string): number {
  const scoped = day ? revenueSalesOnDay(sales, day) : revenueSales(sales);
  return scoped.length;
}
