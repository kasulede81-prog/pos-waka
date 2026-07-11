import type { CashExpense, Customer, Product, ReturnRecord, Sale, Supplier } from "../../../types";
import type { DateFilterBounds, DateFilterValue } from "../../../lib/dateFilters";
import { resolveSoldByUserId, type SoldByLabelContext } from "../../../lib/soldByLabels";
import {
  addDaysToDateKey,
  enumerateDaysInBounds,
  resolveDateFilterBounds,
  revenueSalesInBounds,
} from "../../../lib/dateFilters";
import { dateKeyKampala, monthKeyKampala } from "../../../lib/datesUg";
import {
  localGetCustomerInsights,
  localGetInventoryInsights,
  localGetRangeSummary,
  type ProductRank,
} from "../../../lib/localReporting";
import {
  averageSaleUgx,
  computeDailyRevenueSparkline,
  countUniqueCustomers,
  formatShortUgx,
  pctChangeLabel,
  type SparkPoint,
} from "../../../lib/commandCenterPageView";
import { sumCashExpensesInBounds } from "../../../lib/cashReconciliation";
import type {
  AiInsightCard,
  AnalyticsKpiCard,
  AnalyticsKpiId,
  LeaderboardRow,
  PaymentMixSlice,
} from "../types";

export function categoryLabelKey(category: string): string {
  return `baCategory_${category}`;
}

export function extendedPresetToFilter(preset: string): DateFilterValue {
  const today = dateKeyKampala(new Date());
  if (preset === "today") return { kind: "preset", preset: "today" };
  if (preset === "yesterday") return { kind: "preset", preset: "yesterday" };
  if (preset === "this_week") return { kind: "preset", preset: "this_week" };
  if (preset === "last_7_days") return { kind: "range", fromKey: addDaysToDateKey(today, -6), toKey: today };
  if (preset === "this_month") return { kind: "preset", preset: "this_month" };
  if (preset === "last_month") {
    const parts = today.split("-").map(Number);
    const prev = new Date(parts[0] ?? 2020, (parts[1] ?? 1) - 2, 1);
    const mk = monthKeyKampala(prev);
    const lastDay = new Date(parts[0] ?? 2020, (parts[1] ?? 1) - 1, 0);
    return { kind: "range", fromKey: `${mk}-01`, toKey: dateKeyKampala(lastDay) };
  }
  if (preset === "this_year") return { kind: "range", fromKey: `${today.slice(0, 4)}-01-01`, toKey: today };
  return { kind: "preset", preset: "today" };
}

export function previousPeriodFilter(filter: DateFilterValue): DateFilterValue {
  const bounds = resolveDateFilterBounds(filter);
  const daySpan = Math.max(1, enumerateDaysInBounds(bounds).length);
  const priorToKey = addDaysToDateKey(bounds.fromKey, -1);
  const priorFromKey = addDaysToDateKey(bounds.fromKey, -daySpan);
  return { kind: "range", fromKey: priorFromKey, toKey: priorToKey };
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function computePaymentMethodMix(sales: Sale[], bounds: DateFilterBounds): PaymentMixSlice[] {
  const buckets = { cash: 0, mobile_money: 0, atm: 0, credit: 0, mixed: 0 };
  for (const s of revenueSalesInBounds(sales, bounds)) {
    const amt = Math.max(0, s.totalUgx);
    const method = s.paymentMethod ?? (s.debtUgx > 0 ? "credit" : "cash");
    if (method === "cash") buckets.cash += amt;
    else if (method === "mobile_money") buckets.mobile_money += amt;
    else if (method === "atm") buckets.atm += amt;
    else if (method === "credit") buckets.credit += amt;
    else buckets.mixed += amt;
  }
  const total = Object.values(buckets).reduce((a, b) => a + b, 0) || 1;
  const defs: Array<{ id: keyof typeof buckets; labelKey: string; colorClass: string }> = [
    { id: "cash", labelKey: "baPayCash", colorClass: "bg-emerald-500" },
    { id: "mobile_money", labelKey: "baPayMobile", colorClass: "bg-sky-500" },
    { id: "atm", labelKey: "baPayCard", colorClass: "bg-violet-500" },
    { id: "credit", labelKey: "baPayCredit", colorClass: "bg-amber-500" },
    { id: "mixed", labelKey: "baPayMixed", colorClass: "bg-stone-400" },
  ];
  return defs
    .map((d) => ({
      id: d.id,
      labelKey: d.labelKey,
      amountUgx: buckets[d.id],
      pct: Math.round((buckets[d.id] / total) * 1000) / 10,
      colorClass: d.colorClass,
    }))
    .filter((s) => s.amountUgx > 0);
}

export function computeTopCashiers(
  sales: Sale[],
  bounds: DateFilterBounds,
  ctx: SoldByLabelContext,
  limit = 5,
): LeaderboardRow[] {
  const map = new Map<string, { label: string; revenue: number; count: number }>();
  for (const s of revenueSalesInBounds(sales, bounds)) {
    const id = s.soldByUserId?.trim() || "unknown";
    const label = resolveSoldByUserId(ctx.lang, id === "unknown" ? null : id, ctx.nameByUserId, ctx.shopDisplayName);
    const cur = map.get(id) ?? { label, revenue: 0, count: 0 };
    cur.revenue += s.totalUgx;
    cur.count += 1;
    map.set(id, cur);
  }
  return [...map.entries()]
    .map(([id, row]) => ({
      id,
      label: row.label,
      value: formatShortUgx(row.revenue),
      sub: `${row.count} sales`,
      sortKey: row.revenue,
    }))
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, limit)
    .map(({ id, label, value, sub }) => ({ id, label, value, sub }));
}

export function productLeaderboard(rows: ProductRank[], field: "revenue" | "profit" | "quantity", limit = 5): LeaderboardRow[] {
  const sorted = [...rows];
  if (field === "profit") sorted.sort((a, b) => b.profitUgx - a.profitUgx);
  else if (field === "quantity") sorted.sort((a, b) => b.quantity - a.quantity);
  return sorted.slice(0, limit).map((r) => ({
    id: r.productId || r.name,
    label: r.name,
    value: field === "quantity" ? String(r.quantity) : formatShortUgx(field === "profit" ? r.profitUgx : r.revenueUgx),
    sub: field === "quantity" ? formatShortUgx(r.revenueUgx) : `${r.quantity} sold`,
  }));
}

export function customerLeaderboard(customers: Customer[], sales: Sale[], filter: DateFilterValue, limit = 5): LeaderboardRow[] {
  const insights = localGetCustomerInsights(sales, customers, filter, limit);
  return insights.topCustomers.map((c) => ({
    id: c.customerId,
    label: c.name,
    value: formatShortUgx(c.lifetimeRevenueUgx),
    sub: c.debtBalanceUgx > 0 ? `Debt UGX ${c.debtBalanceUgx.toLocaleString()}` : `${c.purchaseCount} purchases`,
  }));
}

export function buildAnalyticsKpiCards(params: {
  revenue: number;
  profit: number;
  count: number;
  customerCount: number;
  debtOutstanding: number;
  canProfit: boolean;
  compareEnabled: boolean;
  priorRevenue: number;
  priorProfit: number;
  priorCount: number;
  priorCustomers: number;
  priorDebt: number;
  sparkline: SparkPoint[];
}): AnalyticsKpiCard[] {
  const avg = averageSaleUgx(params.revenue, params.count);
  const priorAvg = averageSaleUgx(params.priorRevenue, params.priorCount);
  const cmp = (cur: number, prev: number) =>
    params.compareEnabled ? pctChangeLabel(pctChange(cur, prev)) : null;

  return [
    {
      id: "revenue" as const,
      labelKey: "baKpiRevenue",
      value: formatShortUgx(params.revenue),
      pctChange: cmp(params.revenue, params.priorRevenue),
      sparkline: params.sparkline,
    },
    {
      id: "profit" as const,
      labelKey: "baKpiProfit",
      value: formatShortUgx(params.profit),
      pctChange: cmp(params.profit, params.priorProfit),
      sparkline: params.sparkline,
      valueClass: params.profit >= 0 ? "text-teal-800" : "text-rose-700",
      hidden: !params.canProfit,
    },
    {
      id: "sales" as const,
      labelKey: "baKpiSales",
      value: String(params.count),
      pctChange: cmp(params.count, params.priorCount),
      sparkline: params.sparkline,
    },
    {
      id: "customers" as const,
      labelKey: "baKpiCustomers",
      value: String(params.customerCount),
      pctChange: cmp(params.customerCount, params.priorCustomers),
      sparkline: params.sparkline,
    },
    {
      id: "avg_sale" as const,
      labelKey: "baKpiAvgSale",
      value: formatShortUgx(avg),
      pctChange: cmp(avg, priorAvg),
      sparkline: params.sparkline,
    },
    {
      id: "credit_outstanding" as const,
      labelKey: "baKpiCreditOutstanding",
      value: formatShortUgx(params.debtOutstanding),
      pctChange: cmp(params.debtOutstanding, params.priorDebt),
      sparkline: params.sparkline,
      valueClass: params.debtOutstanding > 0 ? "text-amber-800" : "text-foreground",
    },
  ].filter((c) => !c.hidden);
}

export function buildAiInsights(params: {
  revenue: number;
  profit: number;
  priorRevenue: number;
  priorProfit: number;
  topProduct?: ProductRank;
  inventoryValue: number;
  lowStockCount: number;
  lowStockProduct?: string;
  customerCount: number;
  priorCustomerCount: number;
  canProfit: boolean;
}): AiInsightCard[] {
  const insights: AiInsightCard[] = [];
  const revPct = pctChange(params.revenue, params.priorRevenue);
  if (revPct != null && Math.abs(revPct) >= 1) {
    insights.push({
      id: "sales-change",
      textKey: revPct >= 0 ? "baInsightSalesUp" : "baInsightSalesDown",
      textVars: { pct: Math.abs(revPct).toFixed(0) },
      tone: revPct >= 0 ? "green" : "rose",
    });
  }
  if (params.canProfit && params.topProduct) {
    insights.push({
      id: "top-profit",
      textKey: "baInsightTopProfit",
      textVars: { product: params.topProduct.name },
      tone: "purple",
    });
  }
  if (params.topProduct && params.topProduct.quantity > 0) {
    insights.push({
      id: "top-qty",
      textKey: "baInsightTopSeller",
      textVars: { product: params.topProduct.name, qty: params.topProduct.quantity },
      tone: "blue",
    });
  }
  if (params.inventoryValue > 0) {
    insights.push({
      id: "inventory-value",
      textKey: "baInsightInventoryValue",
      textVars: { value: formatShortUgx(params.inventoryValue) },
      tone: "orange",
    });
  }
  if (params.lowStockCount > 0 && params.lowStockProduct) {
    insights.push({
      id: "low-stock",
      textKey: "baInsightLowStock",
      textVars: { product: params.lowStockProduct },
      tone: "rose",
    });
  }
  if (params.customerCount > params.priorCustomerCount && params.priorCustomerCount > 0) {
    insights.push({
      id: "retention",
      textKey: "baInsightCustomers",
      textVars: { count: params.customerCount },
      tone: "green",
    });
  }
  if (params.canProfit && params.revenue > 0 && params.priorRevenue > 0) {
    const marginPct = Math.round((params.profit / params.revenue) * 100);
    const priorMargin = Math.round((params.priorProfit / params.priorRevenue) * 100);
    if (priorMargin > 0 && marginPct < priorMargin - 2) {
      insights.push({
        id: "margin-drop",
        textKey: "baInsightMarginDrop",
        textVars: { pct: priorMargin - marginPct },
        tone: "orange",
      });
    }
  }
  return insights.slice(0, 5);
}

export function trendBars(days: { day: string; revenueUgx: number }[]) {
  const max = Math.max(1, ...days.map((d) => d.revenueUgx));
  return days.map((d) => {
    const parts = d.day.split("-").map(Number);
    const dt = new Date(parts[0] ?? 2020, (parts[1] ?? 1) - 1, parts[2] ?? 1);
    const label = dt.toLocaleDateString([], { weekday: "short" }).slice(0, 3);
    return {
      day: d.day,
      label,
      total: d.revenueUgx,
      barPx: Math.max(6, Math.round((d.revenueUgx / max) * 88)),
    };
  });
}

export function computeRangeAnalytics(
  sales: Sale[],
  products: Product[],
  customers: Customer[],
  returns: ReturnRecord[],
  suppliers: Supplier[],
  filter: DateFilterValue,
  cashExpenses: CashExpense[],
  compareEnabled: boolean,
) {
  const bounds = resolveDateFilterBounds(filter);
  const current = localGetRangeSummary(sales, products, customers, returns, suppliers, filter, cashExpenses);
  const priorFilter = previousPeriodFilter(filter);
  const priorBounds = resolveDateFilterBounds(priorFilter);
  const prior = compareEnabled
    ? localGetRangeSummary(sales, products, customers, returns, suppliers, priorFilter, cashExpenses)
    : null;

  return {
    current,
    prior,
    bounds,
    priorBounds,
    customerCount: countUniqueCustomers(sales, bounds),
    priorCustomerCount: compareEnabled ? countUniqueCustomers(sales, priorBounds) : 0,
    sparkline: computeDailyRevenueSparkline(sales, 7),
    paymentMix: computePaymentMethodMix(sales, bounds),
    inventory: localGetInventoryInsights(products),
    expensesUgx: sumCashExpensesInBounds(cashExpenses, bounds),
    trendBars: trendBars(current.dailyTrend),
  };
}

export function kpiCategoryForId(id: AnalyticsKpiId): string {
  if (id === "revenue" || id === "sales" || id === "avg_sale") return "sales";
  if (id === "profit") return "profit";
  if (id === "customers") return "customers";
  if (id === "credit_outstanding") return "debts";
  return "overview";
}
