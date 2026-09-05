/**
 * RPT-P2-04 — Reports financial completeness.
 *
 * Incremental sales hydration may leave RAM with only the first page of
 * active sales while the remainder (returns, archives, sales tail) is still
 * arriving. `useShopReportBundle.loading` must not mean "shell ready";
 * financial output is final only when this module says the required dataset
 * is complete.
 */

import type { DayCloseSummary } from "../types";
import { enumerateDaysInBounds, type DateFilterBounds } from "./dateFilters";
import { resolvePeriodReportAuthority, resolveReportAuthority, type PeriodReportAuthority } from "./closedDayAuthority";

export type ReportsHydrationStage = "none" | "critical" | "interactive" | "background" | "complete";

export type ReportsSalesHistoryHydration = { active: boolean; loaded?: number; total?: number } | null;

export type ReportsHydrationInputs = {
  hydrationStage: ReportsHydrationStage;
  salesHistoryHydration: ReportsSalesHistoryHydration;
};

export type ReportsDataCompleteness = {
  remainderReady: boolean;
  salesHydrating: boolean;
  dataComplete: boolean;
};

export type ReportsFinancialReadiness = {
  dataComplete: boolean;
  remainderReady: boolean;
  salesHydrating: boolean;
  canShowLiveFinancials: boolean;
  canShowFrozenHeadlines: boolean;
  canExport: boolean;
  /** True when live financial KPIs/charts must not render numbers as final. */
  loading: boolean;
};

export const REPORTS_DATA_COMPLETE_FLAGS = {
  loading: false,
  dataComplete: true,
  remainderReady: true,
} as const;

/** Remainder buckets (returns, archives, expenses, closes) are in RAM. */
export function isReportsRemainderReady(stage: ReportsHydrationStage): boolean {
  return stage === "complete";
}

/**
 * Authoritative signal: every required active-sales page and remainder bucket
 * has finished loading. Do not infer this from `sales.length` or a lone
 * `loading === false`.
 */
export function isReportsSourceDataComplete(input: ReportsHydrationInputs): boolean {
  return resolveReportsDataCompleteness(input).dataComplete;
}

export function resolveReportsDataCompleteness(input: ReportsHydrationInputs): ReportsDataCompleteness {
  const remainderReady = isReportsRemainderReady(input.hydrationStage);
  const salesHydrating = Boolean(input.salesHistoryHydration?.active);
  return {
    remainderReady,
    salesHydrating,
    dataComplete: remainderReady && !salesHydrating,
  };
}

export function resolveReportsFinancialReadiness(input: {
  hydrationStage: ReportsHydrationStage;
  salesHistoryHydration: ReportsSalesHistoryHydration;
  authority: PeriodReportAuthority;
}): ReportsFinancialReadiness {
  const completeness = resolveReportsDataCompleteness(input);
  if (completeness.dataComplete) {
    return {
      ...completeness,
      canShowLiveFinancials: true,
      canShowFrozenHeadlines: input.authority !== "live",
      canExport: true,
      loading: false,
    };
  }
  const canShowFrozenHeadlines = input.authority === "closed_snapshot";
  return {
    ...completeness,
    canShowLiveFinancials: false,
    canShowFrozenHeadlines,
    canExport: false,
    loading: !canShowFrozenHeadlines,
  };
}

export function canExportReportsData(input: { dataComplete: boolean }): boolean {
  return input.dataComplete;
}

/** Export builders must not run against a known-incomplete dataset. */
export function runReportsExportIfComplete<T>(dataComplete: boolean, build: () => T): T | null {
  if (!dataComplete) return null;
  return build();
}

export type FrozenPeriodHeadlines = {
  revenue: number;
  profit: number;
  count: number;
  debt: number;
  cash: number;
  cashUnavailable: boolean;
};

/**
 * Sum closed-day snapshots for a fully-closed period. Does not read live sales,
 * so incomplete hydration cannot inflate overlay (`live + frozen − undercounted liveDay`).
 */
export function sumFrozenPeriodHeadlines(
  dayCloses: DayCloseSummary[] | undefined,
  bounds: DateFilterBounds,
): FrozenPeriodHeadlines | null {
  if (resolvePeriodReportAuthority(dayCloses, bounds) !== "closed_snapshot") return null;
  const days = enumerateDaysInBounds(bounds);
  if (days.length === 0) return null;
  let revenue = 0;
  let profit = 0;
  let count = 0;
  let debt = 0;
  let cash = 0;
  let cashUnavailable = false;
  for (const day of days) {
    const frozen = resolveReportAuthority(dayCloses, day).frozenTotals;
    if (!frozen) return null;
    revenue += frozen.totalSalesUgx;
    profit += frozen.profitEstimateUgx;
    count += frozen.transactionCount ?? 0;
    debt += frozen.totalDebtUgx;
    if (frozen.cashFromSalesUgx != null) {
      cash += frozen.cashFromSalesUgx;
    } else {
      cashUnavailable = true;
    }
  }
  return { revenue, profit, count, debt, cash: cashUnavailable ? 0 : cash, cashUnavailable };
}

export type ReportsCompletenessBundleFields = {
  loading: boolean;
  dataComplete: boolean;
  remainderReady: boolean;
};

export type ReportsFinancialBundleCore = {
  authority: PeriodReportAuthority;
  closedDayBreakdownUnavailable: boolean;
  physicalCashUnavailable?: boolean;
  revenue: number;
  cash: number;
  profit: number;
  debt: number;
  count: number;
  discountsUgx: number;
  taxesUgx: number;
  topProducts: unknown[];
  slowProducts: unknown[];
  marginLeaders: unknown[];
  dailyTrend: unknown[];
};

/**
 * Replace live/overlaid financials when the required sales/returns dataset is
 * incomplete. Closed-day headlines come from snapshots only. Live/mixed periods
 * expose zeros plus `loading: true` so UI cannot present partial totals as final.
 */
export function applyReportsCompletenessToBundle<T extends ReportsFinancialBundleCore>(
  bundle: T,
  readiness: ReportsFinancialReadiness,
  frozenHeadlines: FrozenPeriodHeadlines | null,
): T & ReportsCompletenessBundleFields {
  const flags: ReportsCompletenessBundleFields = {
    loading: readiness.loading,
    dataComplete: readiness.dataComplete,
    remainderReady: readiness.remainderReady,
  };
  if (readiness.dataComplete) {
    return { ...bundle, ...flags };
  }
  if (readiness.canShowFrozenHeadlines && frozenHeadlines) {
    return {
      ...bundle,
      revenue: frozenHeadlines.revenue,
      cash: frozenHeadlines.cashUnavailable ? 0 : frozenHeadlines.cash,
      physicalCashUnavailable: frozenHeadlines.cashUnavailable,
      profit: frozenHeadlines.profit,
      debt: frozenHeadlines.debt,
      count: frozenHeadlines.count,
      discountsUgx: 0,
      taxesUgx: 0,
      topProducts: [],
      slowProducts: [],
      marginLeaders: [],
      dailyTrend: [],
      closedDayBreakdownUnavailable: true,
      ...flags,
    };
  }
  return {
    ...bundle,
    revenue: 0,
    cash: 0,
    profit: 0,
    debt: 0,
    count: 0,
    discountsUgx: 0,
    taxesUgx: 0,
    topProducts: [],
    slowProducts: [],
    marginLeaders: [],
    dailyTrend: [],
    loading: true,
    dataComplete: false,
    remainderReady: readiness.remainderReady,
  };
}

export function reportsCategoryBlocksOnIncompleteSales(
  category:
    | "overview"
    | "sales"
    | "profit"
    | "products"
    | "inventory"
    | "customers"
    | "debts"
    | "expenses"
    | "purchases"
    | "cash_flow"
    | "employees"
    | "taxes"
    | "performance"
    | "forecast",
): boolean {
  return category !== "inventory" && category !== "forecast" && category !== "performance";
}
