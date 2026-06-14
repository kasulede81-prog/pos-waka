/**
 * Single-pass Owner Dashboard aggregation — preserves financial outputs.
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
import { isLowStock } from "./sellingEngine";
import { buildCombinedReportingIndex } from "./salesDayIndex";
import { pendingSales } from "./saleStatus";
import {
  buildDailyOwnerSummaryLines,
  buildWhatsAppOwnerSummaryLine,
  computeBusinessPulse,
  computeCashierTrustRows,
  computeExtendedOwnerAlerts,
  formatVsYesterday,
  type CashierTrustRow,
} from "./ownerIntelligence";
import type { OwnerAlert } from "./ownerAlerts";
import { getCompletedFinancialsFromScoped } from "./financialMetrics";
import { computeBackOfficeAccessStats } from "./backOfficeAccessStats";
import { buildOwnerRiskCards, type OwnerRiskCard } from "./ownerRiskDashboard";

export type OwnerDashboardStats = {
  totalSalesUgx: number;
  grossSalesUgx: number;
  voidsTotalUgx: number;
  expectedCashUgx: number;
  debtTodayUgx: number;
  debtCollectedUgx: number;
  estProfitUgx: number;
  returnsTotalUgx: number;
  countedCashUgx: number | null;
  todayCloseDiff: number | null;
  shortageUgx: number | null;
  saleCount: number;
};

export type OwnerDashboardData = {
  todayKey: string;
  yesterdayKey: string;
  today: Sale[];
  todayVoids: VoidRecord[];
  todayReturns: ReturnRecord[];
  todayDiscountTotal: number;
  todayDiscountEvents: AuditLogEntry[];
  todayCatalogEvents: AuditLogEntry[];
  todayPriceChangeEvents: AuditLogEntry[];
  todayStaffCatalogEvents: AuditLogEntry[];
  stats: OwnerDashboardStats;
  yesterdaySalesUgx: number;
  lowStock: Product[];
  fastMovers: Array<{ name: string; qty: number; revenue: number }>;
  cashierPerf: Array<{ userId: string; label: string; count: number; revenue: number }>;
  debtSaleCount: number;
  ownerAlertsResolved: OwnerAlert[];
  dangerCount: number;
  warnCount: number;
  pulse: ReturnType<typeof computeBusinessPulse>;
  trustRows: CashierTrustRow[];
  backOfficeAccess: ReturnType<typeof computeBackOfficeAccessStats>;
  riskCards: OwnerRiskCard[];
  openBillsCount: number;
  expiringMedicinesCount: number;
};

type BuildParams = {
  lang: Language;
  sales: Sale[];
  products: Product[];
  auditLogs: AuditLogEntry[];
  returnRecords: ReturnRecord[];
  voidRecords: VoidRecord[];
  dayCloses: DayCloseSummary[];
  preferences: ShopPreferences;
  drawerToday: { debtCollectedUgx: number; expectedDrawerCashUgx: number };
  hospitalityMode: boolean;
  pharmacyMode: boolean;
};

function cashierLabel(userId: string): string {
  return userId.startsWith("local:") ? userId.replace("local:", "") : userId.slice(0, 8) + "…";
}

export function buildOwnerDashboardData(params: BuildParams): OwnerDashboardData {
  const {
    lang,
    sales,
    products,
    auditLogs,
    returnRecords,
    voidRecords,
    dayCloses,
    preferences,
    drawerToday,
    hospitalityMode,
    pharmacyMode,
  } = params;

  const todayKey = dateKeyKampala(new Date());
  const yesterdayKey = dateKeyDaysAgoKampala(1);
  const { revenueIndex, dayIndex: salesIndex, todayAggregates } = buildCombinedReportingIndex(
    sales,
    returnRecords,
    undefined,
    todayKey,
  );
  const today = revenueIndex.salesByDay.get(todayKey) ?? [];

  const todayVoids: VoidRecord[] = [];
  const todayReturns: ReturnRecord[] = [];
  for (const v of voidRecords) {
    if (dateKeyKampala(v.createdAt) === todayKey) todayVoids.push(v);
  }
  for (const r of returnRecords) {
    if (dateKeyKampala(r.createdAt) === todayKey) todayReturns.push(r);
  }

  const finToday = getCompletedFinancialsFromScoped(
    today,
    revenueIndex.returnsByDay.get(todayKey) ?? [],
    products,
  );
  const finYesterday = getCompletedFinancialsFromScoped(
    revenueIndex.salesByDay.get(yesterdayKey) ?? [],
    revenueIndex.returnsByDay.get(yesterdayKey) ?? [],
    products,
  );

  let voidsTotalUgx = 0;
  for (const v of todayVoids) voidsTotalUgx += Math.max(0, v.amountUgx);

  let returnsTotalUgx = 0;
  for (const r of todayReturns) returnsTotalUgx += Math.max(0, r.refundAmountUgx);

  const closeToday = dayCloses.find((d) => d.dateKey === todayKey && !d.supersededAt);
  const countedCashUgx = closeToday?.countedCashUgx ?? null;
  const todayCloseDiff = closeToday?.differenceUgx ?? null;
  const shortageUgx = closeToday && closeToday.differenceUgx < 0 ? -closeToday.differenceUgx : null;

  const stats: OwnerDashboardStats = {
    totalSalesUgx: finToday.revenueUgx,
    grossSalesUgx: finToday.revenueUgx + voidsTotalUgx + returnsTotalUgx,
    voidsTotalUgx,
    expectedCashUgx: drawerToday.expectedDrawerCashUgx,
    debtTodayUgx: finToday.debtIssuedUgx,
    debtCollectedUgx: drawerToday.debtCollectedUgx,
    estProfitUgx: finToday.profitUgx,
    returnsTotalUgx,
    countedCashUgx,
    todayCloseDiff,
    shortageUgx,
    saleCount: finToday.transactionCount,
  };

  const yesterdaySalesUgx = finYesterday.revenueUgx;
  const lowStock = products.filter((p) => isLowStock(p));

  const productMap = todayAggregates.productMap;
  const cashierMap = todayAggregates.cashierMap;
  const todayDiscountTotal = todayAggregates.discountTotal;
  const debtSaleCount = todayAggregates.debtSaleCount;

  const fastMovers = [...productMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const cashierPerf = [...cashierMap.entries()]
    .map(([userId, v]) => ({ userId, label: cashierLabel(userId), ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  const todayDiscountEvents: AuditLogEntry[] = [];
  const todayCatalogRaw: AuditLogEntry[] = [];
  const todayAuditLogs: AuditLogEntry[] = [];
  let staffCatalogTodayCount = 0;
  let staffCatalogTodaySensitive = false;

  let productRemoves14d = 0;
  let manualStockHits7d = 0;
  const minKey14 = dateKeyDaysAgoKampala(14);
  const minKey7 = dateKeyDaysAgoKampala(7);
  const stockAdjustRecent: AuditLogEntry[] = [];

  for (const e of auditLogs) {
    const eKey = dateKeyKampala(e.at);
    if (eKey === todayKey) {
      todayAuditLogs.push(e);
      if (e.action === "discount_given") todayDiscountEvents.push(e);
      if (isCatalogTamperAction(e.action)) {
        todayCatalogRaw.push(e);
        if (e.action !== "price_change" && e.role !== "owner") {
          staffCatalogTodayCount += 1;
          if (isSensitiveCatalogEvent(e)) staffCatalogTodaySensitive = true;
        }
      }
    }
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

  const todayCatalogEvents = todayCatalogRaw.slice(0, 8);
  const todayPriceChangeEvents = todayCatalogRaw.filter((e) => e.action === "price_change");
  const todayStaffCatalogEvents = todayCatalogRaw.filter((e) => e.role !== "owner");

  const ownerAlertsResolved = computeExtendedOwnerAlerts({
    products,
    dayCloses,
    auditLogs,
    preferences,
    todayDebtUgx: stats.debtTodayUgx,
    sales,
    todayKey,
    salesIndex,
    staffCatalogTodayCount,
    staffCatalogTodaySensitive,
    auditWeekMetrics: { productRemoves14d, manualStockHits7d },
    recentStockAdjustments: stockAdjustRecent,
    refundsTodayCount: todayAggregates.refundSaleCount,
  });

  let dangerCount = 0;
  let warnCount = 0;
  for (const a of ownerAlertsResolved) {
    if (a.tone === "danger") dangerCount += 1;
    else if (a.tone === "warn") warnCount += 1;
  }

  const pulse = computeBusinessPulse({
    todaySalesUgx: stats.totalSalesUgx,
    yesterdaySalesUgx,
    alertDangerCount: dangerCount,
    alertWarnCount: warnCount,
  });

  const trustRows = computeCashierTrustRows(lang, today, auditLogs, todayKey, todayAuditLogs);
  const backOfficeAccess = computeBackOfficeAccessStats(auditLogs, todayKey);
  const riskCards = buildOwnerRiskCards({
    lang,
    todayKey,
    todayAuditLogs,
    todayReturns,
    todayVoids,
  });

  const openBillsCount = hospitalityMode ? pendingSales(sales).length : 0;
  const expiringMedicinesCount = pharmacyMode
    ? products.filter((p) => p.expiryDate && new Date(p.expiryDate).getTime() <= Date.now() + 30 * 86400000).length
    : 0;

  return {
    todayKey,
    yesterdayKey,
    today,
    todayVoids,
    todayReturns,
    todayDiscountTotal,
    todayDiscountEvents,
    todayCatalogEvents,
    todayPriceChangeEvents,
    todayStaffCatalogEvents,
    stats,
    yesterdaySalesUgx,
    lowStock,
    fastMovers,
    cashierPerf,
    debtSaleCount,
    ownerAlertsResolved,
    dangerCount,
    warnCount,
    pulse,
    trustRows,
    backOfficeAccess,
    riskCards,
    openBillsCount,
    expiringMedicinesCount,
  };
}

export function buildOwnerSummaryLines(
  lang: Language,
  data: OwnerDashboardData,
): { summaryLines: string[]; waLine: string; trendLine: string } {
  const summaryInput = {
    totalSalesUgx: data.stats.totalSalesUgx,
    estProfitUgx: data.stats.estProfitUgx,
    debtTodayUgx: data.stats.debtTodayUgx,
    saleCount: data.stats.saleCount,
    debtSaleCount: data.debtSaleCount,
    topProductName: data.fastMovers[0]?.name ?? null,
    lowProductName: data.lowStock[0]?.name ?? null,
    cashShortUgx: data.stats.shortageUgx,
    yesterdaySalesUgx: data.yesterdaySalesUgx,
  };
  return {
    summaryLines: buildDailyOwnerSummaryLines(lang, summaryInput),
    waLine: buildWhatsAppOwnerSummaryLine(lang, summaryInput),
    trendLine: formatVsYesterday(lang, data.stats.totalSalesUgx, data.yesterdaySalesUgx),
  };
}
