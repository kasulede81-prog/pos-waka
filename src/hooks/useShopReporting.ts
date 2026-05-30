import { useEffect, useMemo, useState } from "react";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "./useDeferredReportingSales";
import { useSubscription } from "../context/SubscriptionContext";
import {
  localGetRangeSummary,
  localGetWeeklySalesSummary,
  type ProductRank,
  type ReportRange,
  type DailySalesSummary,
  type WeeklySalesSummary,
  type MonthlySalesSummary,
} from "../lib/localReporting";
import type { ReportDataSource, ReportQueryMeta } from "../lib/shopReporting";
import {
  getCustomerInsights,
  getDailySalesSummary,
  getInventoryInsights,
  getMonthlySalesSummary,
  getTopProducts,
  getWeeklySalesSummary,
} from "../lib/shopReporting";

export type ShopReportBundle = {
  source: ReportDataSource;
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
  meta: ReportQueryMeta | null;
  loading: boolean;
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

export function useShopReportBundle(range: ReportRange, includeArchived: boolean): ShopReportBundle {
  const { authMode } = useSubscription();
  const sales = useDeferredReportingSales(includeArchived);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const returns = usePosStore((s) => s.returnRecords);
  const suppliers = usePosStore((s) => s.suppliers);
  const [serverMeta, setServerMeta] = useState<ReportQueryMeta | null>(null);
  const [serverSnapshot, setServerSnapshot] = useState<{
    cash: number;
    profit: number;
    debt: number;
    count: number;
    discountsUgx: number;
    taxesUgx: number;
    topProducts: ProductRank[];
    slowProducts: ProductRank[];
    debtOutstanding: number;
    stockValueAtCost: number;
    dailyTrend: { day: string; revenueUgx: number; transactionCount: number }[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const local = useMemo(
    () => localGetRangeSummary(sales, products, customers, returns, suppliers, range),
    [sales, products, customers, returns, suppliers, range],
  );

  const localCash = (local.summary as DailySalesSummary | WeeklySalesSummary | MonthlySalesSummary).cashCollectedUgx
    ?? local.summary.totalRevenueUgx;
  const localDebt = "debtIssuedUgx" in local.summary ? local.summary.debtIssuedUgx : 0;

  useEffect(() => {
    if (authMode !== "supabase") {
      setServerSnapshot(null);
      setServerMeta(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        let meta: ReportQueryMeta | null = null;
        let cash = 0;
        let profit = 0;
        let debt = 0;
        let count = 0;
        let discountsUgx = 0;
        let taxesUgx = 0;
        let topProducts: ProductRank[] = [];
        let slowProducts: ProductRank[] = [];
        let dailyTrend = local.dailyTrend;
        let debtOutstanding = local.customers.totalDebtOutstandingUgx;
        let stockValueAtCost = local.inventory.stockValueAtCostUgx;
        let gotServer = false;

        if (range === "today") {
          const { data, meta: m } = await getDailySalesSummary();
          meta = m;
          if (data && m.source === "server" && !m.error) {
            gotServer = true;
            cash = data.cashCollectedUgx;
            profit = data.estimatedProfitUgx;
            debt = data.debtIssuedUgx;
            count = data.transactionCount;
            discountsUgx = data.discountsUgx;
            taxesUgx = data.taxesUgx;
          }
        } else if (range === "week") {
          const [weekly, top, slow, cust, inv] = await Promise.all([
            getWeeklySalesSummary(),
            getTopProducts({ order: "top", limit: 10 }),
            getTopProducts({ order: "slow", limit: 8 }),
            getCustomerInsights(),
            getInventoryInsights(),
          ]);
          meta = weekly.meta;
          if (weekly.data && weekly.meta.source === "server" && !weekly.meta.error) {
            gotServer = true;
            cash = weekly.data.cashCollectedUgx;
            count = weekly.data.transactionCount;
            topProducts = weekly.data.topProducts;
            dailyTrend = weekly.data.dailyTrend;
          }
          if (top.meta.source === "server" && top.products.length) topProducts = top.products;
          if (slow.meta.source === "server") slowProducts = slow.products;
          if (cust.data) debtOutstanding = cust.data.totalDebtOutstandingUgx;
          if (inv.data) stockValueAtCost = inv.data.stockValueAtCostUgx;
          profit = local.profitUgx;
        } else {
          const [monthly, top, slow, cust, inv] = await Promise.all([
            getMonthlySalesSummary(),
            getTopProducts({ order: "top", limit: 10 }),
            getTopProducts({ order: "slow", limit: 8 }),
            getCustomerInsights(),
            getInventoryInsights(),
          ]);
          meta = monthly.meta;
          if (monthly.data && monthly.meta.source === "server" && !monthly.meta.error) {
            gotServer = true;
            cash = monthly.data.cashCollectedUgx;
            profit = monthly.data.estimatedProfitUgx;
            debt = monthly.data.debtIssuedUgx;
            count = monthly.data.transactionCount;
          }
          if (top.meta.source === "server") topProducts = top.products;
          if (slow.meta.source === "server") slowProducts = slow.products;
          if (cust.data) debtOutstanding = cust.data.totalDebtOutstandingUgx;
          if (inv.data) stockValueAtCost = inv.data.stockValueAtCostUgx;
        }

        if (cancelled) return;
        if (gotServer) {
          setServerSnapshot({
            cash,
            profit,
            debt,
            count,
            discountsUgx,
            taxesUgx,
            topProducts,
            slowProducts,
            debtOutstanding,
            stockValueAtCost,
            dailyTrend,
          });
          setServerMeta(meta);
        } else {
          setServerSnapshot(null);
          setServerMeta(meta);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authMode, range, local.dailyTrend, local.customers.totalDebtOutstandingUgx, local.inventory.stockValueAtCostUgx, local.profitUgx]);

  const useServer = serverSnapshot != null && authMode === "supabase";
  const trendSource = useServer ? serverSnapshot.dailyTrend : local.dailyTrend;

  return {
    source: useServer ? "server" : "local",
    cash: useServer ? serverSnapshot.cash : localCash,
    profit: useServer ? serverSnapshot.profit : local.profitUgx,
    debt: useServer ? serverSnapshot.debt : localDebt,
    count: useServer ? serverSnapshot.count : local.summary.transactionCount,
    discountsUgx: useServer ? serverSnapshot.discountsUgx : ("discountsUgx" in local.summary ? local.summary.discountsUgx : 0),
    taxesUgx: useServer ? serverSnapshot.taxesUgx : ("taxesUgx" in local.summary ? local.summary.taxesUgx : 0),
    debtOutstanding: useServer ? serverSnapshot.debtOutstanding : local.customers.totalDebtOutstandingUgx,
    topProducts: useServer && serverSnapshot.topProducts.length ? serverSnapshot.topProducts : local.topProducts,
    slowProducts: useServer && serverSnapshot.slowProducts.length ? serverSnapshot.slowProducts : local.slowProducts,
    marginLeaders: local.topProducts.filter((p) => p.profitUgx > 0).slice(0, 8),
    dailyTrend: trendBars(trendSource.map((d) => ({ day: d.day, revenueUgx: d.revenueUgx }))),
    stockValueAtCost: useServer ? serverSnapshot.stockValueAtCost : local.inventory.stockValueAtCostUgx,
    supplierDebtTotal: local.supplierDebtTotal,
    meta: serverMeta,
    loading,
  };
}

export function useDashboardAnalytics(includeArchived: boolean) {
  const { authMode } = useSubscription();
  const sales = useDeferredReportingSales(includeArchived);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const returns = usePosStore((s) => s.returnRecords);
  const [server, setServer] = useState<Awaited<ReturnType<typeof import("../lib/shopReporting").getDashboardAnalytics>> | null>(null);

  const localToday = useMemo(
    () => localGetRangeSummary(sales, products, customers, returns, [], "today"),
    [sales, products, customers, returns],
  );
  const localWeekly = useMemo(
    () => localGetWeeklySalesSummary(sales, products, returns),
    [sales, products, returns],
  );

  useEffect(() => {
    if (authMode !== "supabase") {
      setServer(null);
      return;
    }
    let cancelled = false;
    void import("../lib/shopReporting").then(({ getDashboardAnalytics }) =>
      getDashboardAnalytics().then((res) => {
        if (!cancelled) setServer(res);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [authMode]);

  const useServer = server?.data != null && authMode === "supabase";
  const todaySummary = localToday.summary;
  return {
    source: useServer ? ("server" as const) : ("local" as const),
    cashToday: useServer
      ? server!.data!.daily.cashCollectedUgx
      : "cashCollectedUgx" in todaySummary
        ? todaySummary.cashCollectedUgx
        : 0,
    debtToday: useServer
      ? server!.data!.daily.debtIssuedUgx
      : "debtIssuedUgx" in todaySummary
        ? todaySummary.debtIssuedUgx
        : 0,
    cashWeek: useServer ? server!.data!.weekly.cashCollectedUgx : localWeekly.cashCollectedUgx,
    fastMovers: useServer ? server!.data!.weekly.topProducts.slice(0, 8) : localToday.topProducts.slice(0, 8),
    debtOutstanding: useServer ? server!.data!.customers.totalDebtOutstandingUgx : localToday.customers.totalDebtOutstandingUgx,
    meta: server?.meta ?? null,
  };
}
