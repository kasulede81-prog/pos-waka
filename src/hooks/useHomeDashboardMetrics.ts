import { useMemo } from "react";
import { usePosStore } from "../store/usePosStore";
import { useReportingSales } from "./useReportingSales";
import { useReportingReturnRecords } from "./useReportingReturnRecords";
import { useDrawerCashForDay } from "./useDrawerCashForDay";
import { useKampalaCalendarTick } from "./useKampalaCalendarTick";
import {
  filterReturnsForHomeScope,
  filterSalesForHomeScope,
  resolveVisibleHomeMetrics,
  type HomeMetricScope,
} from "../lib/homeVisibility";
import { localGetDailySalesSummary, localGetMonthlySalesSummary } from "../lib/localReporting";
import { formatShortUgx } from "../lib/commandCenterPageView";
import { resolveStableTodayKpi } from "../lib/todayKpiSnapshot";
import { permissionsHasEffective } from "../lib/actorAuthorization";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import type { Language, Permission, UserRole } from "../types";
import { useSubscription } from "../context/SubscriptionContext";
import { t, tTemplate } from "../lib/i18n";

export type HomeTileIntensity = "calm" | "normal" | "high" | "alert";

export type HomeTileLiveStat = {
  /** Resolved label (may include the current month name). */
  label: string;
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
  actorPermissions?: Permission[] | null,
): Record<string, HomeTileLiveStat | undefined> {
  const sales = useReportingSales(false);
  const returns = useReportingReturnRecords(false);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const todayKpiSnapshot = usePosStore((s) => s.todayKpiSnapshot);
  const salesHydrating = usePosStore((s) => s.salesHistoryHydration?.active ?? false);
  const { snapshot, authMode } = useSubscription();
  const homeMetrics = resolveVisibleHomeMetrics(role);
  const profitVisibility = resolveProfitVisibility({ role, snapshot, authMode, actorPermissions });
  const { todayKey, monthKey, monthLabel } = useKampalaCalendarTick(lang);
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
    const computedToday = localGetDailySalesSummary(scopedSales, products, scopedReturns, todayKey);
    const stableToday = resolveStableTodayKpi(
      todayKpiSnapshot,
      {
        transactionCount: computedToday.transactionCount,
        totalRevenueUgx: computedToday.totalRevenueUgx,
      },
      todayKey,
      salesHydrating,
    );
    const today = { ...computedToday, ...stableToday };
    const month = localGetMonthlySalesSummary(scopedSales, products, scopedReturns, monthKey, cashExpenses);
    const totalDebtUgx = customers.reduce((sum, c) => sum + Math.max(0, c.debtBalanceUgx ?? 0), 0);
    const canCash = permissionsHasEffective(role, "day.close", snapshot, authMode, actorPermissions);
    const canDebt = homeMetrics.showShopWideDebt;
    const canProfit = profitVisibility.canProfit;
    const canReports = homeMetrics.showShopWideRevenue;

    const stats: Record<string, HomeTileLiveStat | undefined> = {};

    if (homeMetrics.showShopWideRevenue || homeMetrics.showPersonalRevenue) {
      stats.sell = {
        label: t(lang, "desktopHomeLiveTodaySales"),
        value: t(lang, "desktopHomeLiveTxnCount").replace("{count}", String(today.transactionCount)),
        intensity: today.transactionCount >= 40 ? "high" : today.transactionCount >= 10 ? "normal" : "calm",
      };
    }

    if (canProfit) {
      stats.profit = {
        label: tTemplate(lang, "desktopHomeLiveMonthProfit", { month: monthLabel }),
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
        label: t(lang, "desktopHomeLiveLowStock"),
        value: t(lang, "desktopHomeLiveItemsCount").replace("{count}", String(lowStockCount)),
        intensity: lowStockCount >= 5 ? "alert" : lowStockCount > 0 ? "normal" : "calm",
      };
    }

    if (canCash) {
      stats.cash = {
        label: t(lang, "desktopHomeLiveDrawer"),
        value: formatShortUgx(drawer.expectedDrawerCashUgx),
        intensity: drawer.expectedDrawerCashUgx >= 500_000 ? "high" : "normal",
      };
      stats.cashPosition = {
        label: t(lang, "desktopHomeLiveExpectedCash"),
        value: formatShortUgx(drawer.expectedDrawerCashUgx),
        intensity: drawer.expectedDrawerCashUgx >= 500_000 ? "high" : "normal",
      };
    }

    if (permissionsHasEffective(role, "owner.dashboard", snapshot, authMode, actorPermissions)) {
      stats.commandCenter = {
        label: t(lang, "desktopHomeLiveTodaySales"),
        value: formatShortUgx(today.totalRevenueUgx),
        intensity: revenueIntensity(today.totalRevenueUgx),
      };
    }

    if (homeMetrics.showRecentSalesList) {
      stats.salesHistory = {
        label: t(lang, "desktopHomeLiveTodaySales"),
        value: t(lang, "desktopHomeLiveTxnCount").replace("{count}", String(today.transactionCount)),
        intensity: today.transactionCount >= 20 ? "high" : "normal",
      };
    }

    if (canDebt) {
      stats.debts = {
        label: t(lang, "desktopHomeLiveTotalDue"),
        value: formatShortUgx(totalDebtUgx),
        intensity: totalDebtUgx >= 1_000_000 ? "alert" : totalDebtUgx > 0 ? "normal" : "calm",
      };
    }

    if (canReports) {
      stats.reports = {
        label: tTemplate(lang, "desktopHomeLiveMonthSales", { month: monthLabel }),
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
    monthLabel,
    drawer.expectedDrawerCashUgx,
    lowStockCount,
    homeMetrics,
    profitVisibility.canProfit,
    role,
    snapshot,
    authMode,
    actorPermissions,
    todayKpiSnapshot,
    salesHydrating,
  ]);
}
