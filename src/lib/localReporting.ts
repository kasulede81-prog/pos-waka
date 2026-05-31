/** Client-side report aggregation (offline / local-mode fallback). */

import type { Customer, Product, ReturnRecord, Sale, Supplier } from "../types";
import { dateKeyKampala, dateKeyDaysAgoKampala, monthKeyKampala } from "./datesUg";
import { computeTodayProfitBreakdown } from "./homeProfit";
import { isCompletedSale } from "./saleStatus";
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

export type ReportRange = "today" | "week" | "month";

function salesInRange(sales: Sale[], range: ReportRange): Sale[] {
  const today = dateKeyKampala(new Date());
  const weekCut = dateKeyDaysAgoKampala(6);
  const monthPrefix = today.slice(0, 7);
  return sales.filter((s) => {
    if (!isCompletedSale(s)) return false;
    const k = dateKeyKampala(s.createdAt);
    if (range === "today") return k === today;
    if (range === "week") return k >= weekCut;
    return k.startsWith(monthPrefix);
  });
}

function returnsInRange(returns: ReturnRecord[], range: ReportRange): ReturnRecord[] {
  const today = dateKeyKampala(new Date());
  const weekCut = dateKeyDaysAgoKampala(6);
  const monthPrefix = today.slice(0, 7);
  return returns.filter((r) => {
    const k = dateKeyKampala(r.createdAt);
    if (range === "today") return k === today;
    if (range === "week") return k >= weekCut;
    return k.startsWith(monthPrefix);
  });
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
  const filtered = sales.filter((s) => dateKeyKampala(s.createdAt) === day);
  const filteredReturns = returns.filter((r) => dateKeyKampala(r.createdAt) === day);
  const productById = new Map(products.map((p) => [p.id, p]));
  const breakdown = computeTodayProfitBreakdown(filtered, productById, filteredReturns);
  const revenue = filtered.reduce((a, s) => a + s.totalUgx, 0);
  const tx = filtered.length;
  return {
    day,
    transactionCount: tx,
    totalRevenueUgx: revenue,
    cashCollectedUgx: filtered.reduce((a, s) => a + s.cashPaidUgx, 0),
    debtIssuedUgx: filtered.reduce((a, s) => a + s.debtUgx, 0),
    discountsUgx: filtered.reduce((a, s) => a + (s.discountTotalUgx ?? 0), 0),
    taxesUgx: 0,
    estimatedProfitUgx: breakdown.profitUgx,
    averageTransactionUgx: tx > 0 ? Math.round(revenue / tx) : 0,
  };
}

export function localGetWeeklySalesSummary(
  sales: Sale[],
  products: Product[],
  returns: ReturnRecord[],
): WeeklySalesSummary {
  const endDay = dateKeyKampala(new Date());
  const startDay = dateKeyDaysAgoKampala(6);
  const filtered = sales.filter((s) => {
    const k = dateKeyKampala(s.createdAt);
    return k >= startDay && k <= endDay;
  });
  const filteredReturns = returns.filter((r) => {
    const k = dateKeyKampala(r.createdAt);
    return k >= startDay && k <= endDay;
  });
  const keys: string[] = [];
  for (let i = 6; i >= 0; i--) keys.push(dateKeyDaysAgoKampala(i));
  const dailyTrend = keys.map((day) => {
    const daySales = sales.filter((s) => dateKeyKampala(s.createdAt) === day);
    return {
      day,
      revenueUgx: daySales.reduce((a, s) => a + s.totalUgx, 0),
      transactionCount: daySales.length,
    };
  });
  const customerIds = new Set(filtered.map((s) => s.customerId).filter(Boolean));
  return {
    startDay,
    endDay,
    transactionCount: filtered.length,
    totalRevenueUgx: filtered.reduce((a, s) => a + s.totalUgx, 0),
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
): MonthlySalesSummary {
  const filtered = sales.filter((s) => dateKeyKampala(s.createdAt).startsWith(month));
  const filteredReturns = returns.filter((r) => dateKeyKampala(r.createdAt).startsWith(month));
  const productById = new Map(products.map((p) => [p.id, p]));
  const breakdown = computeTodayProfitBreakdown(filtered, productById, filteredReturns);
  const prevParts = month.split("-").map(Number);
  const prevDate = new Date(prevParts[0] ?? 2020, (prevParts[1] ?? 1) - 2, 1);
  const prevMonth = monthKeyKampala(prevDate);
  const prevRevenue = sales
    .filter((s) => dateKeyKampala(s.createdAt).startsWith(prevMonth))
    .reduce((a, s) => a + s.totalUgx, 0);
  const revenue = filtered.reduce((a, s) => a + s.totalUgx, 0);
  return {
    month,
    transactionCount: filtered.length,
    totalRevenueUgx: revenue,
    cashCollectedUgx: filtered.reduce((a, s) => a + s.cashPaidUgx, 0),
    debtIssuedUgx: filtered.reduce((a, s) => a + s.debtUgx, 0),
    estimatedProfitUgx: breakdown.profitUgx,
    expensesUgx: 0,
    netEarningsUgx: breakdown.profitUgx,
    previousMonthRevenueUgx: prevRevenue,
    revenueGrowthPct: prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 1000) / 10 : null,
  };
}

export function localGetTopProducts(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
  range: ReportRange,
  order: "top" | "slow",
  limit = 10,
): ProductRank[] {
  const filtered = salesInRange(sales, range);
  const filteredReturns = returnsInRange(returns, range);
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
  range: ReportRange,
  limit = 10,
): CustomerInsights {
  const endDay = dateKeyKampala(new Date());
  const startDay = range === "month" ? `${endDay.slice(0, 7)}-01` : range === "week" ? dateKeyDaysAgoKampala(6) : endDay;
  const filtered = salesInRange(sales, range);
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
  range: ReportRange,
) {
  const daily =
    range === "today"
      ? localGetDailySalesSummary(sales, products, returns)
      : localGetDailySalesSummary(sales, products, returns, dateKeyKampala(new Date()));
  const weekly = localGetWeeklySalesSummary(sales, products, returns);
  const monthly = localGetMonthlySalesSummary(sales, products, returns);
  const summary =
    range === "today" ? daily : range === "week" ? weekly : monthly;
  return {
    summary,
    profitUgx: computeTodayProfitBreakdown(
      salesInRange(sales, range),
      new Map(products.map((p) => [p.id, p])),
      returnsInRange(returns, range),
    ).profitUgx,
    weekly: localGetWeeklySalesSummary(sales, products, returns),
    topProducts: localGetTopProducts(sales, returns, products, range, "top", 10),
    slowProducts: localGetTopProducts(sales, returns, products, range, "slow", 8),
    inventory: localGetInventoryInsights(products),
    customers: localGetCustomerInsights(sales, customers, range),
    supplierDebtTotal: suppliers.reduce((a, s) => a + Math.max(0, s.balanceOwedUgx), 0),
    dailyTrend: weekly.dailyTrend,
  };
}
