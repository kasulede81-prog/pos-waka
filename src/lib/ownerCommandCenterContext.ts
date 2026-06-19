/**
 * Alert, risk, and overview context for the owner command center — single build path.
 */

import type {
  AuditLogEntry,
  DayCloseSummary,
  Language,
  Product,
  ReturnRecord,
  Sale,
  ShopPreferences,
  VoidRecord,
} from "../types";
import { dateKeyKampala, dateKeyDaysAgoKampala } from "./datesUg";
import { isCatalogTamperAction, isSensitiveCatalogEvent } from "./catalogAudit";
import { computeExtendedOwnerAlerts } from "./ownerIntelligence";
import type { OwnerAlert } from "./ownerAlerts";
import { getCompletedFinancialsFromScoped, type RevenueSalesIndex } from "./financialMetrics";
import { buildOwnerRiskCards, type OwnerRiskCard } from "./ownerRiskDashboard";
import {
  revenueSalesInBoundsFromIndex,
  returnsInBounds,
  type DateFilterBounds,
} from "./dateFilters";
import { filterAuditLogsInBounds, filterVoidsInBounds } from "./ownerCommandCenter";
import { buildCombinedReportingIndex } from "./salesDayIndex";

export type OwnerCommandCenterOverview = {
  revenueUgx: number;
  profitUgx: number;
  transactionCount: number;
  countedCashUgx: number | null;
};

export function buildOwnerCommandCenterContext(params: {
  lang: Language;
  bounds: DateFilterBounds;
  sales: Sale[];
  products: Product[];
  auditLogs: AuditLogEntry[];
  returnRecords: ReturnRecord[];
  voidRecords: VoidRecord[];
  dayCloses: DayCloseSummary[];
  preferences: ShopPreferences;
}): {
  overview: OwnerCommandCenterOverview;
  ownerAlertsResolved: OwnerAlert[];
  riskCards: OwnerRiskCard[];
  revenueIndex: RevenueSalesIndex;
} {
  const {
    bounds,
    sales,
    products,
    auditLogs,
    returnRecords,
    voidRecords,
    dayCloses,
    preferences,
    lang,
  } = params;

  const todayKey = dateKeyKampala(new Date());
  const periodKey = bounds.toKey;

  const { revenueIndex, dayIndex: salesIndex } = buildCombinedReportingIndex(
    sales,
    returnRecords,
    undefined,
    todayKey,
  );
  const periodSales = bounds.isSingleDay
    ? (revenueIndex.salesByDay.get(bounds.fromKey) ?? [])
    : revenueSalesInBoundsFromIndex(revenueIndex, bounds);
  const periodReturns = returnsInBounds(returnRecords, bounds);
  const periodVoids = filterVoidsInBounds(voidRecords, bounds);
  const periodAuditLogs = filterAuditLogsInBounds(auditLogs, bounds);

  const finPeriod = getCompletedFinancialsFromScoped(periodSales, periodReturns, products);
  const closePrimary = dayCloses.find((d) => d.dateKey === periodKey && !d.supersededAt);
  const countedCashUgx = bounds.isSingleDay ? (closePrimary?.countedCashUgx ?? null) : null;

  let periodRefundSaleCount = 0;
  for (const s of periodSales) {
    if (s.totalUgx < 0) periodRefundSaleCount += 1;
  }

  let productRemoves14d = 0;
  let manualStockHits7d = 0;
  const minKey14 = dateKeyDaysAgoKampala(14);
  const minKey7 = dateKeyDaysAgoKampala(7);
  const stockAdjustRecent: AuditLogEntry[] = [];

  for (const e of auditLogs) {
    const eKey = dateKeyKampala(e.at);
    if (e.action === "stock_adjust" && stockAdjustRecent.length < 40) {
      stockAdjustRecent.push(e);
    }
    if (e.action === "product_remove" && eKey >= minKey14) productRemoves14d += 1;
    if (eKey >= minKey7 && e.action === "stock_adjust") {
      const pl = e.payload as Record<string, unknown>;
      const reason = typeof pl.reason === "string" ? pl.reason : "";
      const d = typeof pl.delta === "number" ? pl.delta : 0;
      if (d < -15 && /damaged|waste|spoiled|broken|theft|missing|adjust|count/i.test(reason)) {
        manualStockHits7d += 1;
      }
    }
  }

  let staffCatalogPeriodCount = 0;
  let staffCatalogPeriodSensitive = false;
  for (const e of periodAuditLogs) {
    if (isCatalogTamperAction(e.action) && e.action !== "price_change" && e.role !== "owner") {
      staffCatalogPeriodCount += 1;
      if (isSensitiveCatalogEvent(e)) staffCatalogPeriodSensitive = true;
    }
  }

  const alertTodayKey = bounds.isSingleDay ? bounds.fromKey : todayKey;

  const ownerAlertsResolved = computeExtendedOwnerAlerts({
    products,
    dayCloses,
    auditLogs: periodAuditLogs,
    preferences,
    todayDebtUgx: finPeriod.debtIssuedUgx,
    sales,
    todayKey: alertTodayKey,
    salesIndex,
    staffCatalogTodayCount: staffCatalogPeriodCount,
    staffCatalogTodaySensitive: staffCatalogPeriodSensitive,
    auditWeekMetrics: { productRemoves14d, manualStockHits7d },
    recentStockAdjustments: stockAdjustRecent,
    refundsTodayCount: periodRefundSaleCount,
  });

  const riskCards = buildOwnerRiskCards({
    lang,
    periodFromKey: bounds.fromKey,
    periodToKey: bounds.toKey,
    todayAuditLogs: periodAuditLogs,
    todayReturns: periodReturns,
    todayVoids: periodVoids,
  });

  return {
    overview: {
      revenueUgx: finPeriod.revenueUgx,
      profitUgx: finPeriod.profitUgx,
      transactionCount: finPeriod.transactionCount,
      countedCashUgx,
    },
    ownerAlertsResolved,
    riskCards,
    revenueIndex,
  };
}
