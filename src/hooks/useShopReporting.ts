import { useMemo } from "react";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "./useDeferredReportingSales";
import { useReportingReturnRecords } from "./useReportingReturnRecords";
import { DEFAULT_DATE_FILTER, type DateFilterValue } from "../lib/dateFilters";
import {
  localGetRangeSummary,
  localGetRollingSevenDaySalesSummary,
  type ProductRank,
  type DailySalesSummary,
  type WeeklySalesSummary,
  type MonthlySalesSummary,
} from "../lib/localReporting";

export type ShopReportBundle = {
  /** Financial totals always from canonical local helpers (getCompletedFinancials). */
  source: "local";
  revenue: number;
  cash: number;
  profit: number;
  debt: number;
  count: number;
  discountsUgx: number;
  taxesUgx: number;
  debtOutstanding: number;
  topProducts: ProductRank[];
  slowProducts: ProductRank[];
  marginLeaders: ProductRank[];
  dailyTrend: { day: string; label: string; total: number; barPx: number }[];
  stockValueAtCost: number;
  supplierDebtTotal: number;
  loading: false;
};

function trendBars(days: { day: string; revenueUgx: number }[]) {
  const max = Math.max(1, ...days.map((d) => d.revenueUgx));
  return days.map((d) => ({
    day: d.day,
    label: d.day.slice(5).replace("-", "/"),
    total: d.revenueUgx,
    barPx: Math.max(6, Math.round((d.revenueUgx / max) * 88)),
  }));
}

export function useShopReportBundle(filter: DateFilterValue, includeArchived: boolean): ShopReportBundle {
  const sales = useDeferredReportingSales(includeArchived);
  const returns = useReportingReturnRecords(includeArchived);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const suppliers = usePosStore((s) => s.suppliers);
  const cashExpenses = usePosStore((s) => s.cashExpenses);

  const local = useMemo(
    () => localGetRangeSummary(sales, products, customers, returns, suppliers, filter, cashExpenses),
    [sales, products, customers, returns, suppliers, filter, cashExpenses],
  );

  const summary = local.summary;
  const cash =
    (summary as DailySalesSummary | WeeklySalesSummary | MonthlySalesSummary).cashCollectedUgx ??
    summary.totalRevenueUgx;
  const debt = "debtIssuedUgx" in summary ? summary.debtIssuedUgx : 0;
  const discountsUgx = "discountsUgx" in summary ? summary.discountsUgx : 0;
  const taxesUgx = "taxesUgx" in summary ? summary.taxesUgx : 0;

  return {
    source: "local",
    revenue: summary.totalRevenueUgx,
    cash,
    profit: local.profitUgx,
    debt,
    count: summary.transactionCount,
    discountsUgx,
    taxesUgx,
    debtOutstanding: local.customers.totalDebtOutstandingUgx,
    topProducts: local.topProducts,
    slowProducts: local.slowProducts,
    marginLeaders: local.topProducts.filter((p) => p.profitUgx > 0).slice(0, 8),
    dailyTrend: trendBars(local.dailyTrend.map((d) => ({ day: d.day, revenueUgx: d.revenueUgx }))),
    stockValueAtCost: local.inventory.stockValueAtCostUgx,
    supplierDebtTotal: local.supplierDebtTotal,
    loading: false,
  };
}

export function useDashboardAnalytics(includeArchived: boolean) {
  const sales = useDeferredReportingSales(includeArchived);
  const returns = useReportingReturnRecords(includeArchived);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);

  const localToday = useMemo(
    () => localGetRangeSummary(sales, products, customers, returns, [], DEFAULT_DATE_FILTER),
    [sales, products, customers, returns],
  );
  const localWeekly = useMemo(
    () => localGetRollingSevenDaySalesSummary(sales, products, returns),
    [sales, products, returns],
  );

  const todaySummary = localToday.summary;
  return {
    source: "local" as const,
    revenueToday: todaySummary.totalRevenueUgx,
    cashToday: "cashCollectedUgx" in todaySummary ? todaySummary.cashCollectedUgx : 0,
    debtToday: "debtIssuedUgx" in todaySummary ? todaySummary.debtIssuedUgx : 0,
    profitToday: localToday.profitUgx,
    cashWeek: localWeekly.cashCollectedUgx,
    fastMovers: localToday.topProducts.slice(0, 8),
    debtOutstanding: localToday.customers.totalDebtOutstandingUgx,
    meta: null,
  };
}
