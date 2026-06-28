import { useMemo } from "react";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "./useDeferredReportingSales";
import { useReportingReturnRecords } from "./useReportingReturnRecords";
import { useDrawerCashForDay } from "./useDrawerCashForDay";
import { dateKeyKampala, monthKeyKampala } from "../lib/datesUg";
import {
  filterReturnsForHomeScope,
  filterSalesForHomeScope,
  resolveVisibleHomeMetrics,
  type HomeMetricScope,
} from "../lib/homeVisibility";
import { localGetDailySalesSummary, localGetMonthlySalesSummary } from "../lib/localReporting";
import { formatShortUgx } from "../lib/commandCenterPageView";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import type { Language, UserRole } from "../types";
import { useSubscription } from "../context/SubscriptionContext";
import { t } from "../lib/i18n";

export type HomeTileIntensity = "calm" | "normal" | "high" | "alert";

export type HomeTileLiveStat = {
  labelKey: string;
  value: string;
  trend?: string;
  intensity: HomeTileIntensity;
};

function pctChange(current: number, prior: number): string | undefined {
  if (prior <= 0 || current <= 0) return undefined;
  const pct = ((current - prior) / prior) * 100;
  const sign = pct >= 0 ? "↑" : "↓";
  return `${sign} ${Math.abs(pct).toFixed(1)}%`;
}

function revenueIntensity(revenueUgx: number): HomeTileIntensity {
  if (revenueUgx >= 500_000) return "high";
  if (revenueUgx >= 100_000) return "normal";
  return "calm";
}

export function useHomeDashboardMetrics(
  lang: Language,
  role: UserRole,
  actorUserId: string,
  lowStockCount: number,
): Record<string, HomeTileLiveStat | undefined> {
  const sales = useDeferredReportingSales(false);
  const returns = useReportingReturnRecords(false);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const { snapshot, authMode } = useSubscription();
  const homeMetrics = resolveVisibleHomeMetrics(role);
  const profitVisibility = resolveProfitVisibility({ role, snapshot, authMode });
  const todayKey = dateKeyKampala(new Date());
  const monthKey = monthKeyKampala(new Date());
  const drawer = useDrawerCashForDay(todayKey);

  const scope: HomeMetricScope = homeMetrics.scope;
  const scopedSales = useMemo(
    () => filterSalesForHomeScope(sales, scope, actorUserId),
    [sales, scope, actorUserId],
  );
  const scopedReturns = useMemo(
    () => filterReturnsForHomeScope(returns, sales, scope, actorUserId),
    [returns, sales, scope, actorUserId],
  );

  return useMemo(() => {
    const today = localGetDailySalesSummary(scopedSales, products, scopedReturns, todayKey);
    const month = localGetMonthlySalesSummary(scopedSales, products, scopedReturns, monthKey, cashExpenses);
    const totalDebtUgx = customers.reduce((sum, c) => sum + Math.max(0, c.debtBalanceUgx ?? 0), 0);
    const canCash = hasEffectivePermission(role, "day.close", snapshot, authMode);
    const canDebt = homeMetrics.showShopWideDebt;
    const canProfit = profitVisibility.canProfit;
    const canReports = homeMetrics.showShopWideRevenue;

    const stats: Record<string, HomeTileLiveStat | undefined> = {};

    if (homeMetrics.showShopWideRevenue || homeMetrics.showPersonalRevenue) {
      stats.sell = {
        labelKey: "desktopHomeLiveTodaySales",
        value: t(lang, "desktopHomeLiveTxnCount").replace("{count}", String(today.transactionCount)),
        intensity: today.transactionCount >= 40 ? "high" : today.transactionCount >= 10 ? "normal" : "calm",
      };
    }

    if (canProfit) {
      stats.profit = {
        labelKey: "desktopHomeLiveThisMonth",
        value: formatShortUgx(month.estimatedProfitUgx),
        trend:
          month.revenueGrowthPct !== null
            ? `${month.revenueGrowthPct >= 0 ? "↑" : "↓"} ${Math.abs(month.revenueGrowthPct).toFixed(1)}%`
            : undefined,
        intensity: revenueIntensity(month.estimatedProfitUgx),
      };
    }

    if (homeMetrics.showInventoryMetrics) {
      stats.inventory = {
        labelKey: "desktopHomeLiveLowStock",
        value: t(lang, "desktopHomeLiveItemsCount").replace("{count}", String(lowStockCount)),
        intensity: lowStockCount >= 5 ? "alert" : lowStockCount > 0 ? "normal" : "calm",
      };
    }

    if (canCash) {
      stats.cash = {
        labelKey: "desktopHomeLiveDrawer",
        value: formatShortUgx(drawer.expectedDrawerCashUgx),
        intensity: drawer.expectedDrawerCashUgx >= 500_000 ? "high" : "normal",
      };
    }

    if (homeMetrics.showRecentSalesList) {
      stats.salesHistory = {
        labelKey: "desktopHomeLiveTodaySales",
        value: t(lang, "desktopHomeLiveTxnCount").replace("{count}", String(today.transactionCount)),
        intensity: today.transactionCount >= 20 ? "high" : "normal",
      };
    }

    if (canDebt) {
      stats.debts = {
        labelKey: "desktopHomeLiveTotalDue",
        value: formatShortUgx(totalDebtUgx),
        intensity: totalDebtUgx >= 1_000_000 ? "alert" : totalDebtUgx > 0 ? "normal" : "calm",
      };
    }

    if (canReports) {
      stats.reports = {
        labelKey: "desktopHomeLiveTotalSales",
        value: formatShortUgx(month.totalRevenueUgx),
        trend:
          month.revenueGrowthPct !== null
            ? `${month.revenueGrowthPct >= 0 ? "↑" : "↓"} ${Math.abs(month.revenueGrowthPct).toFixed(1)}%`
            : pctChange(month.totalRevenueUgx, month.previousMonthRevenueUgx),
        intensity: revenueIntensity(month.totalRevenueUgx),
      };
    }

    return stats;
  }, [
    lang,
    scopedSales,
    scopedReturns,
    products,
    customers,
    cashExpenses,
    todayKey,
    monthKey,
    drawer.expectedDrawerCashUgx,
    lowStockCount,
    homeMetrics,
    profitVisibility.canProfit,
    role,
    snapshot,
    authMode,
  ]);
}
