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
import {
  localGetDailySalesSummary,
  localGetMonthlySalesSummary,
  localGetRollingSevenDaySalesSummary,
} from "../lib/localReporting";
import type { HomePulseSparkMode, HomePulseTrendPoint } from "../lib/homePulseSpark";
import { mergeHomeKpisWithShopOverlay } from "../lib/homeShopKpiOverlay";
import {
  homeKpiAvailabilityHint,
  presentHomeKpiFormattedValue,
  presentHomeKpiStat,
  resolveHomeShopMonthAvailability,
  resolveHomeShopTodayAvailability,
  resolveHomeWeekSparkAvailability,
} from "../lib/homeKpiTrust";
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
import type { SellerMatchActor } from "../lib/sellerIdentity";

export type { HomeTileIntensity, HomeTileLiveStat, HomeExecutiveKpi };

export type HomeDashboardMetrics = {
  byTile: Record<string, HomeTileLiveStat | undefined>;
  executive: HomeExecutiveKpi[];
  /** Existing rolling 7-day Home summary — no invented points. */
  weekTrend: HomePulseTrendPoint[];
  sparkMode: HomePulseSparkMode | null;
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
  actor: SellerMatchActor | string,
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
  const hydrationStage = usePosStore((s) => s.hydrationStage);
  const preferences = usePosStore((s) => s.preferences);
  const { snapshot, authMode } = useSubscription();
  const homeMetrics = resolveVisibleHomeMetrics(role);
  const profitVisibility = resolveProfitVisibility({ role, snapshot, authMode, actorPermissions });
  const { todayKey, monthKey, monthLabel } = useKampalaCalendarTick(lang);
  const drawer = useDrawerCashForDay(todayKey);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const overlayEnabled = authMode === "supabase" && homeMetrics.scope === "shop_wide";
  const shopOverlayState = useShopHomeKpiOverlay({
    enabled: overlayEnabled,
    todayKey,
    monthKey,
  });

  const scope: HomeMetricScope = homeMetrics.scope;
  const actorUserId = typeof actor === "string" ? actor : actor.userId;
  const linkedAuthUserId = typeof actor === "string" ? null : actor.linkedAuthUserId ?? null;
  const scopedSales = useMemo(
    () =>
      filterSalesForHomeScope(sales, scope, {
        userId: actorUserId,
        linkedAuthUserId,
      }),
    [sales, scope, actorUserId, linkedAuthUserId],
  );
  const scopedReturns = useMemo(
    () =>
      filterReturnsForHomeScope(returns, sales, scope, {
        userId: actorUserId,
        linkedAuthUserId,
      }),
    [returns, sales, scope, actorUserId, linkedAuthUserId],
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
    const rollingWeek = localGetRollingSevenDaySalesSummary(scopedSales, products, scopedReturns);
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
      shopOverlayState.overlay,
      { todayKey, monthKey, freezeToday: Boolean(todayClose) },
    );
    today.transactionCount = merged.todayTransactionCount;
    today.totalRevenueUgx = merged.todayRevenueUgx;
    const drawerCashUgx = merged.todayExpectedCashUgx;
    month.totalRevenueUgx = merged.monthRevenueUgx;
    month.estimatedProfitUgx = merged.monthProfitUgx;
    month.previousMonthRevenueUgx = merged.previousMonthRevenueUgx;
    month.revenueGrowthPct = merged.revenueGrowthPct;
    const kpiCopy = {
      loading: t(lang, "homeKpiLoading"),
      unavailable: t(lang, "homeKpiUnavailable"),
    };
    const overlayHasToday =
      shopOverlayState.overlay?.todayTransactionCount != null && shopOverlayState.overlay?.todayRevenueUgx != null;
    const overlayHasMonth = shopOverlayState.overlay?.monthRevenueUgx != null;
    const hydrationComplete = hydrationStage === "complete";
    const todayAvail = resolveHomeShopTodayAvailability({
      scope,
      overlayExpected: shopOverlayState.expected,
      overlayStatus: shopOverlayState.status,
      overlayHasToday,
      freezeToday: Boolean(todayClose),
    });
    const monthAvail = resolveHomeShopMonthAvailability({
      scope,
      overlayExpected: shopOverlayState.expected,
      overlayStatus: shopOverlayState.status,
      overlayHasMonth,
      salesHydrating,
      hydrationComplete,
    });
    const weekAvail = resolveHomeWeekSparkAvailability({ salesHydrating, hydrationComplete });
    const totalDebtUgx = customers.reduce((sum, c) => sum + Math.max(0, c.debtBalanceUgx ?? 0), 0);
    const canCash = permissionsHasEffective(role, "day.close", snapshot, authMode, actorPermissions);
    const canDebt = homeMetrics.showShopWideDebt;
    const canProfit = profitVisibility.canProfit;
    const canReports = homeMetrics.showShopWideRevenue;
    const showTodayRevenue = homeMetrics.showShopWideRevenue || homeMetrics.showPersonalRevenue;

    const byTile: Record<string, HomeTileLiveStat | undefined> = {};

    if (showTodayRevenue) {
      byTile.sell = presentHomeKpiStat(
        {
          label: t(lang, "desktopHomeLiveTodaySales"),
          value: tTemplate(lang, "desktopHomeLiveTxnCount", { count: today.transactionCount }),
          intensity: today.transactionCount >= 40 ? "high" : today.transactionCount >= 10 ? "normal" : "calm",
        },
        todayAvail,
        kpiCopy,
      );
    }

    if (canProfit) {
      byTile.profit = presentHomeKpiStat(
        {
          label: tTemplate(lang, "desktopHomeLiveMonthProfit", { month: monthLabel }),
          value: formatShortUgx(month.estimatedProfitUgx),
          trend:
            month.revenueGrowthPct !== null
              ? `${month.revenueGrowthPct >= 0 ? "↑" : "↓"} ${Math.abs(month.revenueGrowthPct).toFixed(1)}%`
              : undefined,
          intensity: revenueIntensity(month.estimatedProfitUgx),
        },
        monthAvail,
        kpiCopy,
      );
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
      byTile.commandCenter = presentHomeKpiStat(
        {
          label: t(lang, "desktopHomeLiveTodaySales"),
          value: formatShortUgx(today.totalRevenueUgx),
          intensity: revenueIntensity(today.totalRevenueUgx),
        },
        todayAvail,
        kpiCopy,
      );
    }

    if (homeMetrics.showRecentSalesList) {
      byTile.salesHistory = presentHomeKpiStat(
        {
          label: t(lang, "desktopHomeLiveTodaySales"),
          value: tTemplate(lang, "desktopHomeLiveTxnCount", { count: today.transactionCount }),
          intensity: today.transactionCount >= 20 ? "high" : "normal",
        },
        todayAvail,
        kpiCopy,
      );
    }

    if (canDebt) {
      byTile.debts = {
        label: t(lang, "desktopHomeLiveTotalDue"),
        value: formatShortUgx(totalDebtUgx),
        intensity: totalDebtUgx >= 1_000_000 ? "alert" : totalDebtUgx > 0 ? "normal" : "calm",
      };
    }

    if (canReports) {
      byTile.reports = presentHomeKpiStat(
        {
          label: tTemplate(lang, "desktopHomeLiveMonthSales", { month: monthLabel }),
          value: formatShortUgx(month.totalRevenueUgx),
          trend:
            month.revenueGrowthPct !== null
              ? `${month.revenueGrowthPct >= 0 ? "↑" : "↓"} ${Math.abs(month.revenueGrowthPct).toFixed(1)}%`
              : pctChange(month.totalRevenueUgx, month.previousMonthRevenueUgx),
          intensity: revenueIntensity(month.totalRevenueUgx),
        },
        monthAvail,
        kpiCopy,
      );
    }

    let sparkMode: HomePulseSparkMode | null = null;
    if (weekAvail === "ready") {
      if (showTodayRevenue) sparkMode = "revenue";
      else if (homeMetrics.showRecentSalesList || Boolean(byTile.sell)) sparkMode = "transactions";
    }
    const weekTrend: HomePulseTrendPoint[] =
      sparkMode && weekAvail === "ready"
        ? rollingWeek.dailyTrend.map((point) => ({
            day: point.day,
            revenueUgx: point.revenueUgx,
            transactionCount: point.transactionCount,
          }))
        : [];

    const todayRevenueValue = presentHomeKpiFormattedValue(formatShortUgx(today.totalRevenueUgx), todayAvail);
    const executive = buildHomeExecutiveKpis({
      todayRevenueLabel: t(lang, "desktopHomeLiveTodaySales"),
      todayRevenueValue,
      todayRevenueIntensity: todayAvail === "ready" ? revenueIntensity(today.totalRevenueUgx) : "calm",
      todayRevenueHint: homeKpiAvailabilityHint(todayAvail, kpiCopy),
      todayRevenueAvailability: todayAvail,
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

    return { byTile, executive, weekTrend, sparkMode };
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
    hydrationStage,
    pharmacyMode,
    shopOverlayState.overlay,
    shopOverlayState.status,
    shopOverlayState.expected,
  ]);
}
