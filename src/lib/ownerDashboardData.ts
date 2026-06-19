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
import {
  revenueSalesInBounds,
  returnsInBounds,
  type DateFilterBounds,
} from "./dateFilters";
import { sumDebtPaymentsInBounds } from "./customerDebtActivity";
import {
  filterAuditLogsInBounds,
  filterVoidsInBounds,
} from "./ownerCommandCenter";

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
  periodKey: string;
  bounds: DateFilterBounds;
  todayKey: string;
  yesterdayKey: string;
  today: Sale[];
  periodSales: Sale[];
  todayVoids: VoidRecord[];
  periodVoids: VoidRecord[];
  todayReturns: ReturnRecord[];
  periodReturns: ReturnRecord[];
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
  bounds: DateFilterBounds;
  sales: Sale[];
  products: Product[];
  auditLogs: AuditLogEntry[];
  returnRecords: ReturnRecord[];
  voidRecords: VoidRecord[];
  dayCloses: DayCloseSummary[];
  preferences: ShopPreferences;
  debtPayments: import("../types").DebtPayment[];
  expectedCashUgx: number;
  hospitalityMode: boolean;
  pharmacyMode: boolean;
};

function cashierLabel(userId: string): string {
  return userId.startsWith("local:") ? userId.replace("local:", "") : userId.slice(0, 8) + "…";
}

export function buildOwnerDashboardData(params: BuildParams): OwnerDashboardData {
  const {
    lang,
    bounds,
    sales,
    products,
    auditLogs,
    returnRecords,
    voidRecords,
    dayCloses,
    preferences,
    debtPayments,
    expectedCashUgx,
    hospitalityMode,
    pharmacyMode,
  } = params;

  const todayKey = dateKeyKampala(new Date());
  const yesterdayKey = dateKeyDaysAgoKampala(1);
  const periodKey = bounds.toKey;
  const periodSales = revenueSalesInBounds(sales, bounds);
  const periodReturns = returnsInBounds(returnRecords, bounds);
  const periodVoids = filterVoidsInBounds(voidRecords, bounds);
  const periodAuditLogs = filterAuditLogsInBounds(auditLogs, bounds);

  const { revenueIndex, dayIndex: salesIndex } = buildCombinedReportingIndex(
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

  const finPeriod = getCompletedFinancialsFromScoped(periodSales, periodReturns, products);
  const finYesterday = getCompletedFinancialsFromScoped(
    revenueIndex.salesByDay.get(yesterdayKey) ?? [],
    revenueIndex.returnsByDay.get(yesterdayKey) ?? [],
    products,
  );

  let voidsTotalUgx = 0;
  for (const v of periodVoids) voidsTotalUgx += Math.max(0, v.amountUgx);

  let returnsTotalUgx = 0;
  for (const r of periodReturns) returnsTotalUgx += Math.max(0, r.refundAmountUgx);

  const closePrimary = dayCloses.find((d) => d.dateKey === periodKey && !d.supersededAt);
  const countedCashUgx = bounds.isSingleDay ? (closePrimary?.countedCashUgx ?? null) : null;
  const todayCloseDiff = bounds.isSingleDay ? (closePrimary?.differenceUgx ?? null) : null;
  const shortageUgx =
    closePrimary && closePrimary.differenceUgx < 0 ? -closePrimary.differenceUgx : null;

  const stats: OwnerDashboardStats = {
    totalSalesUgx: finPeriod.revenueUgx,
    grossSalesUgx: finPeriod.revenueUgx + voidsTotalUgx + returnsTotalUgx,
    voidsTotalUgx,
    expectedCashUgx,
    debtTodayUgx: finPeriod.debtIssuedUgx,
    debtCollectedUgx: sumDebtPaymentsInBounds(debtPayments, bounds),
    estProfitUgx: finPeriod.profitUgx,
    returnsTotalUgx,
    countedCashUgx,
    todayCloseDiff,
    shortageUgx,
    saleCount: finPeriod.transactionCount,
  };

  const yesterdaySalesUgx = finYesterday.revenueUgx;
  const lowStock = products.filter((p) => isLowStock(p));

  const periodProductMap = new Map<string, { name: string; qty: number; revenue: number }>();
  const periodCashierMap = new Map<string, { count: number; revenue: number }>();
  let periodDiscountTotal = 0;
  let periodDebtSaleCount = 0;
  let periodRefundSaleCount = 0;

  for (const s of periodSales) {
    const uid = s.soldByUserId ?? "unknown";
    const crow = periodCashierMap.get(uid) ?? { count: 0, revenue: 0 };
    crow.count += 1;
    crow.revenue += s.totalUgx;
    periodCashierMap.set(uid, crow);
    if (s.debtUgx > 0) periodDebtSaleCount += 1;
    if (s.totalUgx < 0) periodRefundSaleCount += 1;
    for (const line of s.lines) {
      const pid = line.productId;
      const row = periodProductMap.get(pid) ?? { name: line.name, qty: 0, revenue: 0 };
      row.qty += line.quantity;
      row.revenue += line.lineTotalUgx;
      periodProductMap.set(pid, row);
      periodDiscountTotal += line.discountUgx ?? 0;
    }
  }

  const fastMovers = [...periodProductMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const cashierPerf = [...periodCashierMap.entries()]
    .map(([userId, v]) => ({ userId, label: cashierLabel(userId), ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  const todayDiscountEvents: AuditLogEntry[] = [];
  const todayCatalogRaw: AuditLogEntry[] = [];
  const todayAuditLogs: AuditLogEntry[] = [];

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

  let staffCatalogPeriodCount = 0;
  let staffCatalogPeriodSensitive = false;
  for (const e of periodAuditLogs) {
    if (isCatalogTamperAction(e.action) && e.action !== "price_change" && e.role !== "owner") {
      staffCatalogPeriodCount += 1;
      if (isSensitiveCatalogEvent(e)) staffCatalogPeriodSensitive = true;
    }
  }

  const todayCatalogEvents = todayCatalogRaw.slice(0, 8);
  const todayPriceChangeEvents = todayCatalogRaw.filter((e) => e.action === "price_change");
  const todayStaffCatalogEvents = todayCatalogRaw.filter((e) => e.role !== "owner");

  const alertDebtUgx = finPeriod.debtIssuedUgx;
  const alertTodayKey = bounds.isSingleDay ? bounds.fromKey : todayKey;

  const ownerAlertsResolved = computeExtendedOwnerAlerts({
    products,
    dayCloses,
    auditLogs: periodAuditLogs,
    preferences,
    todayDebtUgx: alertDebtUgx,
    sales,
    todayKey: alertTodayKey,
    salesIndex,
    staffCatalogTodayCount: staffCatalogPeriodCount,
    staffCatalogTodaySensitive: staffCatalogPeriodSensitive,
    auditWeekMetrics: { productRemoves14d, manualStockHits7d },
    recentStockAdjustments: stockAdjustRecent,
    refundsTodayCount: periodRefundSaleCount,
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

  const trustRows = computeCashierTrustRows(lang, periodSales, auditLogs, alertTodayKey, periodAuditLogs, {
    shifts: preferences.shifts ?? [],
    voidRecords: periodVoids,
    returnRecords: periodReturns,
  });
  const backOfficeAccess = computeBackOfficeAccessStats(auditLogs, alertTodayKey);
  const riskCards = buildOwnerRiskCards({
    lang,
    periodFromKey: bounds.fromKey,
    periodToKey: bounds.toKey,
    todayAuditLogs: periodAuditLogs,
    todayReturns: periodReturns,
    todayVoids: periodVoids,
  });

  const openBillsCount = hospitalityMode ? pendingSales(sales).length : 0;
  const expiringMedicinesCount = pharmacyMode
    ? products.filter((p) => p.expiryDate && new Date(p.expiryDate).getTime() <= Date.now() + 30 * 86400000).length
    : 0;

  return {
    periodKey,
    bounds,
    todayKey,
    yesterdayKey,
    today,
    periodSales,
    todayVoids,
    periodVoids,
    todayReturns,
    periodReturns,
    todayDiscountTotal: periodDiscountTotal,
    todayDiscountEvents,
    todayCatalogEvents,
    todayPriceChangeEvents,
    todayStaffCatalogEvents,
    stats,
    yesterdaySalesUgx,
    lowStock,
    fastMovers,
    cashierPerf,
    debtSaleCount: periodDebtSaleCount,
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
