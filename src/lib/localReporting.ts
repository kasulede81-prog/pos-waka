/** Client-side report aggregation (offline / local-mode fallback). */

import type { Customer, Product, ReturnRecord, Sale, Supplier } from "../types";
import { dateKeyDaysAgoKampala, dateKeyKampala, monthKeyKampala, saleReportingDayKey } from "./datesUg";
import {
  enumerateDaysInBounds,
  resolveDateFilterBounds,
  returnsInBounds,
  revenueSalesInBounds,
  type DateFilterValue,
} from "./dateFilters";
import { sumCashExpensesInMonth } from "./cashReconciliation";
import type { CashExpense } from "../types";
import { getCompletedFinancials, isRevenueSale } from "./financialMetrics";
import { computeTodayProfitBreakdown } from "./homeProfit";
import { isLowStock } from "./sellingEngine";

export type ProductRank = {
  productId: string;
  name: string;
  quantity: number;
  revenueUgx: number;
  profitUgx: number;
};

export type DailySalesSummary = {
  day: string;
  transactionCount: number;
  totalRevenueUgx: number;
  cashCollectedUgx: number;
  debtIssuedUgx: number;
  discountsUgx: number;
  taxesUgx: number;
  estimatedProfitUgx: number;
  averageTransactionUgx: number;
};

export type WeeklySalesSummary = {
  startDay: string;
  endDay: string;
  transactionCount: number;
  totalRevenueUgx: number;
  cashCollectedUgx: number;
  dailyTrend: { day: string; revenueUgx: number; transactionCount: number }[];
  topProducts: ProductRank[];
  activeCustomers: number;
};

export type MonthlySalesSummary = {
  month: string;
  transactionCount: number;
  totalRevenueUgx: number;
  cashCollectedUgx: number;
  debtIssuedUgx: number;
  estimatedProfitUgx: number;
  expensesUgx: number;
  netEarningsUgx: number;
  previousMonthRevenueUgx: number;
  revenueGrowthPct: number | null;
};

export type InventoryInsights = {
  stockValueAtCostUgx: number;
  lowStock: { productId: string; name: string; stockOnHand: number; minimumStockAlert: number }[];
  outOfStock: { productId: string; name: string }[];
  restockRecommendations: {
    productId: string;
    name: string;
    stockOnHand: number;
    minimumStockAlert: number;
    suggestedReorderQty: number;
  }[];
};

export type CustomerInsights = {
  startDay: string;
  endDay: string;
  topCustomers: {
    customerId: string;
    name: string;
    purchaseCount: number;
    lifetimeRevenueUgx: number;
    debtBalanceUgx: number;
  }[];
  totalDebtOutstandingUgx: number;
  customersWithDebt: number;
};

export type { ReportRange } from "./dateFilters";

function salesForFilter(sales: Sale[], filter: DateFilterValue): Sale[] {
  const bounds = resolveDateFilterBounds(filter);
  return revenueSalesInBounds(sales, bounds);
}

function returnsForFilter(returns: ReturnRecord[], filter: DateFilterValue): ReturnRecord[] {
  const bounds = resolveDateFilterBounds(filter);
  return returnsInBounds(returns, bounds);
}

function rankProducts(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
  order: "top" | "slow",
  limit: number,
): ProductRank[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const map = new Map<string, ProductRank>();
  for (const sale of sales) {
    for (const line of sale.lines) {
      if (line.voided) continue;
      const cur = map.get(line.productId) ?? {
        productId: line.productId,
        name: line.name,
        quantity: 0,
        revenueUgx: 0,
        profitUgx: 0,
      };
      const unitCost =
        Number.isFinite(line.unitCostUgx) && line.unitCostUgx >= 0
          ? line.unitCostUgx
          : (productById.get(line.productId)?.costPricePerUnitUgx ?? 0);
      const lineProfit = Number.isFinite(line.estimatedProfitUgx)
        ? line.estimatedProfitUgx
        : Math.round(line.lineTotalUgx - line.quantity * unitCost);
      map.set(line.productId, {
        productId: line.productId,
        name: line.name,
        quantity: cur.quantity + line.quantity,
        revenueUgx: cur.revenueUgx + line.lineTotalUgx,
        profitUgx: cur.profitUgx + lineProfit,
      });
    }
  }
  for (const ret of returns) {
    const cur = map.get(ret.productId) ?? {
      productId: ret.productId,
      name: ret.productName,
      quantity: 0,
      revenueUgx: 0,
      profitUgx: 0,
    };
    const product = productById.get(ret.productId);
    const returnCost = Math.round(Math.max(0, ret.quantity) * Math.max(0, product?.costPricePerUnitUgx ?? 0));
    const returnProfit = Math.max(0, ret.refundAmountUgx) - returnCost;
    map.set(ret.productId, {
      productId: ret.productId,
      name: ret.productName || cur.name,
      quantity: cur.quantity - Math.max(0, ret.quantity),
      revenueUgx: cur.revenueUgx - Math.max(0, ret.refundAmountUgx),
      profitUgx: cur.profitUgx - returnProfit,
    });
  }
  const rows = [...map.values()].filter((r) => r.revenueUgx > 0);
  rows.sort((a, b) => (order === "slow" ? a.revenueUgx - b.revenueUgx : b.revenueUgx - a.revenueUgx));
  return rows.slice(0, limit);
}

export function localGetDailySalesSummary(
  sales: Sale[],
  products: Product[],
  returns: ReturnRecord[],
  day = dateKeyKampala(new Date()),
): DailySalesSummary {
  const fin = getCompletedFinancials(sales, returns, products, { day });
  return {
    day,
    transactionCount: fin.transactionCount,
    totalRevenueUgx: fin.revenueUgx,
    cashCollectedUgx: fin.cashCollectedUgx,
    debtIssuedUgx: fin.debtIssuedUgx,
    discountsUgx: fin.discountsUgx,
    taxesUgx: 0,
    estimatedProfitUgx: fin.profitUgx,
    averageTransactionUgx: fin.averageTransactionUgx,
  };
}

/** Home dashboard hint — rolling last 7 calendar days (not Monday week). */
export function localGetRollingSevenDaySalesSummary(
  sales: Sale[],
  products: Product[],
  returns: ReturnRecord[],
): WeeklySalesSummary {
  const endDay = dateKeyKampala(new Date());
  const startDay = dateKeyDaysAgoKampala(6);
  const filtered = sales.filter((s) => {
    if (!isRevenueSale(s)) return false;
    const k = saleReportingDayKey(s);
    return k >= startDay && k <= endDay;
  });
  const filteredReturns = returns.filter((r) => {
    const k = dateKeyKampala(r.createdAt);
    return k >= startDay && k <= endDay;
  });
  const keys: string[] = [];
  for (let i = 6; i >= 0; i--) keys.push(dateKeyDaysAgoKampala(i));
  return buildWeeklySummaryFromFiltered(sales, products, returns, filtered, filteredReturns, startDay, endDay, keys);
}

export function localGetWeeklySalesSummary(
  sales: Sale[],
  products: Product[],
  returns: ReturnRecord[],
  now: Date = new Date(),
): WeeklySalesSummary {
  const bounds = resolveDateFilterBounds({ kind: "preset", preset: "this_week" }, now);
  const startDay = bounds.fromKey;
  const endDay = bounds.toKey;
  const filtered = revenueSalesInBounds(sales, bounds);
  const filteredReturns = returnsInBounds(returns, bounds);
  const keys = enumerateDaysInBounds(bounds);
  return buildWeeklySummaryFromFiltered(sales, products, returns, filtered, filteredReturns, startDay, endDay, keys);
}

function buildWeeklySummaryFromFiltered(
  sales: Sale[],
  products: Product[],
  returns: ReturnRecord[],
  filtered: Sale[],
  filteredReturns: ReturnRecord[],
  startDay: string,
  endDay: string,
  keys: string[],
): WeeklySalesSummary {
  const dailyTrend = keys.map((day) => {
    const dayFin = getCompletedFinancials(sales, returns, products, { day });
    return {
      day,
      revenueUgx: dayFin.revenueUgx,
      transactionCount: dayFin.transactionCount,
    };
  });
  const customerIds = new Set(filtered.map((s) => s.customerId).filter(Boolean));
  const productById = new Map(products.map((p) => [p.id, p]));
  const breakdown = computeTodayProfitBreakdown(filtered, productById, filteredReturns);
  return {
    startDay,
    endDay,
    transactionCount: filtered.length,
    totalRevenueUgx: breakdown.salesUgx,
    cashCollectedUgx: filtered.reduce((a, s) => a + s.cashPaidUgx, 0),
    dailyTrend,
    topProducts: rankProducts(filtered, filteredReturns, products, "top", 10),
    activeCustomers: customerIds.size,
  };
}

export function localGetMonthlySalesSummary(
  sales: Sale[],
  products: Product[],
  returns: ReturnRecord[],
  month = monthKeyKampala(new Date()),
  cashExpenses: CashExpense[] = [],
): MonthlySalesSummary {
  const fin = getCompletedFinancials(sales, returns, products, { monthKey: month });
  const prevParts = month.split("-").map(Number);
  const prevDate = new Date(prevParts[0] ?? 2020, (prevParts[1] ?? 1) - 2, 1);
  const prevMonth = monthKeyKampala(prevDate);
  const prevRevenue = getCompletedFinancials(sales, returns, products, { monthKey: prevMonth }).revenueUgx;
  const revenue = fin.revenueUgx;
  const expensesUgx = sumCashExpensesInMonth(cashExpenses, month);
  const grossProfitUgx = fin.profitUgx;
  return {
    month,
    transactionCount: fin.transactionCount,
    totalRevenueUgx: revenue,
    cashCollectedUgx: fin.cashCollectedUgx,
    debtIssuedUgx: fin.debtIssuedUgx,
    estimatedProfitUgx: grossProfitUgx,
    expensesUgx,
    netEarningsUgx: grossProfitUgx - expensesUgx,
    previousMonthRevenueUgx: prevRevenue,
    revenueGrowthPct: prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 1000) / 10 : null,
  };
}

export function localGetTopProducts(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
  filter: DateFilterValue,
  order: "top" | "slow",
  limit = 10,
): ProductRank[] {
  const filtered = salesForFilter(sales, filter);
  const filteredReturns = returnsForFilter(returns, filter);
  return rankProducts(filtered, filteredReturns, products, order, limit);
}

export function localGetInventoryInsights(products: Product[]): InventoryInsights {
  const stockValueAtCostUgx = products.reduce(
    (a, p) => a + Math.max(0, p.stockOnHand) * Math.max(0, p.costPricePerUnitUgx),
    0,
  );
  const lowStock = products
    .filter((p) => p.stockOnHand > 0 && isLowStock(p))
    .sort((a, b) => a.stockOnHand - b.stockOnHand)
    .slice(0, 20)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      stockOnHand: p.stockOnHand,
      minimumStockAlert: p.minimumStockAlert,
    }));
  const outOfStock = products
    .filter((p) => p.stockOnHand <= 0)
    .slice(0, 30)
    .map((p) => ({ productId: p.id, name: p.name }));
  const restockRecommendations = products
    .filter((p) => isLowStock(p) || p.stockOnHand <= 0)
    .sort((a, b) => a.stockOnHand - b.stockOnHand)
    .slice(0, 15)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      stockOnHand: p.stockOnHand,
      minimumStockAlert: p.minimumStockAlert,
      suggestedReorderQty: Math.max(p.minimumStockAlert * 2 - p.stockOnHand, p.minimumStockAlert),
    }));
  return { stockValueAtCostUgx, lowStock, outOfStock, restockRecommendations };
}

export function localGetCustomerInsights(
  sales: Sale[],
  customers: Customer[],
  filter: DateFilterValue,
  limit = 10,
): CustomerInsights {
  const bounds = resolveDateFilterBounds(filter);
  const startDay = bounds.fromKey;
  const endDay = bounds.toKey;
  const filtered = salesForFilter(sales, filter);
  const debtCustomers = customers.filter((c) => c.debtBalanceUgx > 0);
  const topCustomers = customers
    .map((c) => {
      const customerSales = filtered.filter((s) => s.customerId === c.id);
      return {
        customerId: c.id,
        name: c.name,
        purchaseCount: customerSales.length,
        lifetimeRevenueUgx: customerSales.reduce((a, s) => a + s.totalUgx, 0),
        debtBalanceUgx: c.debtBalanceUgx,
      };
    })
    .sort((a, b) => b.lifetimeRevenueUgx - a.lifetimeRevenueUgx)
    .slice(0, limit);
  return {
    startDay,
    endDay,
    topCustomers,
    totalDebtOutstandingUgx: customers.reduce((a, c) => a + c.debtBalanceUgx, 0),
    customersWithDebt: debtCustomers.length,
  };
}

export function localGetRangeSummary(
  sales: Sale[],
  products: Product[],
  customers: Customer[],
  returns: ReturnRecord[],
  suppliers: Supplier[],
  filter: DateFilterValue,
  cashExpenses: CashExpense[] = [],
) {
  const bounds = resolveDateFilterBounds(filter);
  const weekly = localGetWeeklySalesSummary(sales, products, returns);
  const monthly = localGetMonthlySalesSummary(
    sales,
    products,
    returns,
    monthKeyKampala(bounds.toKey),
    cashExpenses,
  );
  let summary: DailySalesSummary | WeeklySalesSummary | MonthlySalesSummary;
  let dailyTrend = weekly.dailyTrend;
  if (filter.kind === "preset" && filter.preset === "this_month") {
    summary = monthly;
    dailyTrend = weekly.dailyTrend;
  } else if (filter.kind === "preset" && filter.preset === "this_week") {
    summary = weekly;
    dailyTrend = weekly.dailyTrend;
  } else {
    const dayKey = bounds.fromKey;
    const dayFin = getCompletedFinancials(sales, returns, products, { day: dayKey });
    summary = {
      day: dayKey,
      transactionCount: dayFin.transactionCount,
      totalRevenueUgx: dayFin.revenueUgx,
      cashCollectedUgx: dayFin.cashCollectedUgx,
      debtIssuedUgx: dayFin.debtIssuedUgx,
      discountsUgx: dayFin.discountsUgx,
      taxesUgx: 0,
      estimatedProfitUgx: dayFin.profitUgx,
      averageTransactionUgx: dayFin.averageTransactionUgx,
    };
    dailyTrend = [{ day: dayKey, revenueUgx: dayFin.revenueUgx, transactionCount: dayFin.transactionCount }];
  }

  const filteredSales = salesForFilter(sales, filter);
  const filteredReturns = returnsForFilter(returns, filter);

  return {
    summary,
    profitUgx: computeTodayProfitBreakdown(
      filteredSales,
      new Map(products.map((p) => [p.id, p])),
      filteredReturns,
    ).profitUgx,
    weekly,
    topProducts: localGetTopProducts(sales, returns, products, filter, "top", 10),
    slowProducts: localGetTopProducts(sales, returns, products, filter, "slow", 8),
    inventory: localGetInventoryInsights(products),
    customers: localGetCustomerInsights(sales, customers, filter),
    supplierDebtTotal: suppliers.reduce((a, s) => a + Math.max(0, s.balanceOwedUgx), 0),
    dailyTrend,
  };
}
