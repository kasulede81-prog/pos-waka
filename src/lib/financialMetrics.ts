/**
 * Canonical financial metrics for dashboards and reports.
 * Revenue counts only completed sales — never pending/cancelled/open bills.
 */

import type { Product, ReturnRecord, Sale } from "../types";
import { dateKeyKampala, saleReportingDayKey } from "./datesUg";
import { computeCanonicalRevenueUgx } from "./canonicalRevenue";
import { computeTodayProfitBreakdown } from "./homeProfit";
import { isCompletedSale } from "./saleStatus";

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

export function getCompletedFinancials(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
  opts?: { day?: string; monthKey?: string; skipProfit?: boolean },
): CompletedFinancialSnapshot {
  let scoped = revenueSales(sales);
  if (opts?.day) {
    scoped = scoped.filter((s) => saleReportingDayKey(s) === opts.day);
  } else if (opts?.monthKey) {
    scoped = scoped.filter((s) => saleReportingDayKey(s).startsWith(opts.monthKey!));
  }

  const returnScoped = opts?.day
    ? returns.filter((r) => dateKeyKampala(r.createdAt) === opts.day)
    : opts?.monthKey
      ? returns.filter((r) => dateKeyKampala(r.createdAt).startsWith(opts.monthKey!))
      : returns;

  const productById = new Map(products.map((p) => [p.id, p]));
  const breakdown = opts?.skipProfit
    ? { profitUgx: 0, salesUgx: 0, costUgx: 0, linesMissingCost: 0 }
    : computeTodayProfitBreakdown(scoped, productById, returnScoped);
  const tx = scoped.length;
  const revenue = computeCanonicalRevenueUgx(scoped, returnScoped);

  return {
    revenueUgx: revenue,
    profitUgx: breakdown.profitUgx,
    transactionCount: tx,
    cashCollectedUgx: scoped.reduce((a, s) => a + s.cashPaidUgx, 0),
    debtIssuedUgx: scoped.reduce((a, s) => a + s.debtUgx, 0),
    discountsUgx: scoped.reduce((a, s) => a + (s.discountTotalUgx ?? 0), 0),
    averageTransactionUgx: tx > 0 ? Math.round(revenue / tx) : 0,
  };
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
