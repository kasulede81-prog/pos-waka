import { useMemo } from "react";
import { usePosStore } from "../store/usePosStore";
import { useReportingSales } from "./useReportingSales";
import { useReportingReturnRecords } from "./useReportingReturnRecords";
import { useDrawerCashForDay } from "./useDrawerCashForDay";
import { useKampalaCalendarTick } from "./useKampalaCalendarTick";
import { useShopHomeKpiOverlay } from "./useShopHomeKpiOverlay";
import {
  filterReturnsForHomeScope,
  filterSalesForHomeScope,
  resolveVisibleHomeMetrics,
  type HomeMetricScope,
} from "../lib/homeVisibility";
import { localGetDailySalesSummary, localGetMonthlySalesSummary } from "../lib/localReporting";
import { mergeHomeKpisWithShopOverlay } from "../lib/homeShopKpiOverlay";
import { authoritativeCloseForDate, readClosedDayTotals } from "../lib/closedDayAuthority";
import { formatShortUgx } from "../lib/commandCenterPageView";
import { resolveStableTodayKpi } from "../lib/todayKpiSnapshot";
import { permissionsHasEffective } from "../lib/actorAuthorization";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import type { Language, Permission, UserRole } from "../types";
import { useSubscription } from "../context/SubscriptionContext";
import { t, tTemplate } from "../lib/i18n";
import {
  buildHomeExecutiveKpis,
  type HomeExecutiveKpi,
  type HomeTileIntensity,
  type HomeTileLiveStat,
} from "../lib/homeExecutiveKpis";
import { POS_RECEIPTS_ROUTE } from "../lib/posNavigation";
import { isPharmacyMode } from "../lib/pharmacy";

export type { HomeTileIntensity, HomeTileLiveStat, HomeExecutiveKpi };

export type HomeDashboardMetrics = {
  byTile: Record<string, HomeTileLiveStat | undefined>;
  executive: HomeExecutiveKpi[];
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
): HomeDashboardMetrics {
  const sales = useReportingSales(false);
  const returns = useReportingReturnRecords(false);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const todayKpiSnapshot = usePosStore((s) => s.todayKpiSnapshot);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const salesHydrating = usePosStore((s) => s.salesHistoryHydration?.active ?? false);
  const preferences = usePosStore((s) => s.preferences);
  const { snapshot, authMode } = useSubscription();
  const homeMetrics = resolveVisibleHomeMetrics(role);
  const profitVisibility = resolveProfitVisibility({ role, snapshot, authMode, actorPermissions });
  const { todayKey, monthKey, monthLabel } = useKampalaCalendarTick(lang);
  const drawer = useDrawerCashForDay(todayKey);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const shopOverlay = useShopHomeKpiOverlay({
    enabled: authMode === "supabase" && homeMetrics.scope === "shop_wide",
    todayKey,
    monthKey,
  });

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
    const computedToday = localGetDailySalesSummary(scopedSales, products, scopedReturns, todayKey, dayCloses);
    const todayClose = authoritativeCloseForDate(dayCloses, todayKey);
    const stableToday = todayClose
      ? {
          transactionCount: computedToday.transactionCount,
          totalRevenueUgx: computedToday.totalRevenueUgx,
        }
      : resolveStableTodayKpi(
          todayKpiSnapshot,
          {
            transactionCount: computedToday.transactionCount,
            totalRevenueUgx: computedToday.totalRevenueUgx,
          },
          todayKey,
          salesHydrating,
        );
    const today = { ...computedToday, ...stableToday };
    const frozenDrawer = todayClose ? readClosedDayTotals(todayClose) : null;
    const localDrawerCashUgx = frozenDrawer?.expectedCashUgx ?? drawer.expectedDrawerCashUgx;
    const month = localGetMonthlySalesSummary(scopedSales, products, scopedReturns, monthKey, cashExpenses);
    const merged = mergeHomeKpisWithShopOverlay(
      {
        todayTransactionCount: today.transactionCount,
        todayRevenueUgx: today.totalRevenueUgx,
        todayExpectedCashUgx: localDrawerCashUgx,
        monthRevenueUgx: month.totalRevenueUgx,
        monthProfitUgx: month.estimatedProfitUgx,
        previousMonthRevenueUgx: month.previousMonthRevenueUgx,
        revenueGrowthPct: month.revenueGrowthPct,
      },
      shopOverlay,
      { todayKey, monthKey, freezeToday: Boolean(todayClose) },
    );
    today.transactionCount = merged.todayTransactionCount;
    today.totalRevenueUgx = merged.todayRevenueUgx;
    const drawerCashUgx = merged.todayExpectedCashUgx;
    month.totalRevenueUgx = merged.monthRevenueUgx;
    month.estimatedProfitUgx = merged.monthProfitUgx;
    month.previousMonthRevenueUgx = merged.previousMonthRevenueUgx;
    month.revenueGrowthPct = merged.revenueGrowthPct;
    const totalDebtUgx = customers.reduce((sum, c) => sum + Math.max(0, c.debtBalanceUgx ?? 0), 0);
    const canCash = permissionsHasEffective(role, "day.close", snapshot, authMode, actorPermissions);
    const canDebt = homeMetrics.showShopWideDebt;
    const canProfit = profitVisibility.canProfit;
    const canReports = homeMetrics.showShopWideRevenue;
    const showTodayRevenue = homeMetrics.showShopWideRevenue || homeMetrics.showPersonalRevenue;

    const byTile: Record<string, HomeTileLiveStat | undefined> = {};

    if (showTodayRevenue) {
      byTile.sell = {
        label: t(lang, "desktopHomeLiveTodaySales"),
        value: tTemplate(lang, "desktopHomeLiveTxnCount", { count: today.transactionCount }),
        intensity: today.transactionCount >= 40 ? "high" : today.transactionCount >= 10 ? "normal" : "calm",
      };
    }

    if (canProfit) {
      byTile.profit = {
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
      byTile.inventory = {
        label: t(lang, "desktopHomeLiveLowStock"),
        value: tTemplate(lang, "desktopHomeLiveItemsCount", { count: lowStockCount }),
        intensity: lowStockCount >= 5 ? "alert" : lowStockCount > 0 ? "normal" : "calm",
      };
    }

    if (canCash) {
      byTile.cash = {
        label: t(lang, "desktopHomeLiveDrawer"),
        value: formatShortUgx(drawerCashUgx),
        intensity: drawerCashUgx >= 500_000 ? "high" : "normal",
      };
      byTile.cashPosition = {
        label: t(lang, "desktopHomeLiveExpectedCash"),
        value: formatShortUgx(drawerCashUgx),
        intensity: drawerCashUgx >= 500_000 ? "high" : "normal",
      };
    }

    if (permissionsHasEffective(role, "owner.dashboard", snapshot, authMode, actorPermissions)) {
      byTile.commandCenter = {
        label: t(lang, "desktopHomeLiveTodaySales"),
        value: formatShortUgx(today.totalRevenueUgx),
        intensity: revenueIntensity(today.totalRevenueUgx),
      };
    }

    if (homeMetrics.showRecentSalesList) {
      byTile.salesHistory = {
        label: t(lang, "desktopHomeLiveTodaySales"),
        value: tTemplate(lang, "desktopHomeLiveTxnCount", { count: today.transactionCount }),
        intensity: today.transactionCount >= 20 ? "high" : "normal",
      };
    }

    if (canDebt) {
      byTile.debts = {
        label: t(lang, "desktopHomeLiveTotalDue"),
        value: formatShortUgx(totalDebtUgx),
        intensity: totalDebtUgx >= 1_000_000 ? "alert" : totalDebtUgx > 0 ? "normal" : "calm",
      };
    }

    if (canReports) {
      byTile.reports = {
        label: tTemplate(lang, "desktopHomeLiveMonthSales", { month: monthLabel }),
        value: formatShortUgx(month.totalRevenueUgx),
        trend:
          month.revenueGrowthPct !== null
            ? `${month.revenueGrowthPct >= 0 ? "↑" : "↓"} ${Math.abs(month.revenueGrowthPct).toFixed(1)}%`
            : pctChange(month.totalRevenueUgx, month.previousMonthRevenueUgx),
        intensity: revenueIntensity(month.totalRevenueUgx),
      };
    }

    const executive = buildHomeExecutiveKpis({
      todayRevenueLabel: t(lang, "desktopHomeLiveTodaySales"),
      todayRevenueValue: formatShortUgx(today.totalRevenueUgx),
      todayRevenueIntensity: revenueIntensity(today.totalRevenueUgx),
      showTodayRevenue,
      transactions: byTile.sell,
      profit: byTile.profit,
      cash: byTile.cash,
      inventory: byTile.inventory,
      debts: byTile.debts,
      reportsPath: pharmacyMode ? "/pharmacy/reports" : "/reports",
      receiptsPath: pharmacyMode ? "/pharmacy/returns" : POS_RECEIPTS_ROUTE,
      profitPath: "/office/profit",
      cashPath: "/office/cash-drawer",
      inventoryPath: pharmacyMode ? "/pharmacy/inventory" : "/stock",
      debtsPath: "/debts",
    });

    return { byTile, executive };
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
    dayCloses,
    lowStockCount,
    homeMetrics,
    profitVisibility.canProfit,
    role,
    snapshot,
    authMode,
    actorPermissions,
    todayKpiSnapshot,
    salesHydrating,
    pharmacyMode,
    shopOverlay,
  ]);
}
