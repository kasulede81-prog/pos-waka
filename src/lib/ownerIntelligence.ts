import type { AuditLogEntry, DayCloseSummary, Product, Sale, ShopPreferences } from "../types";
import { dateKeyKampala } from "./datesUg";
import { catalogEventsForDay, isSensitiveCatalogEvent } from "./catalogAudit";
import { computeOwnerAlerts, type OwnerAlert } from "./ownerAlerts";
import {
  avgDailyUnitsFromIndex,
  buildSalesDayIndex,
  salesForDay,
  sumRevenueForDay,
  type SalesDayIndex,
} from "./salesDayIndex";

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateKeyKampala(d);
}

export function computeExtendedOwnerAlerts(params: {
  products: Product[];
  dayCloses: DayCloseSummary[];
  auditLogs: AuditLogEntry[];
  preferences: ShopPreferences;
  todayDebtUgx: number;
  sales: Sale[];
  todayKey: string;
  salesIndex?: SalesDayIndex;
  staffCatalogTodayCount?: number;
  staffCatalogTodaySensitive?: boolean;
  refundsTodayCount?: number;
  auditWeekMetrics?: {
    productRemoves14d: number;
    manualStockHits7d: number;
  };
  recentStockAdjustments?: AuditLogEntry[];
}): OwnerAlert[] {
  const {
    products,
    dayCloses,
    auditLogs,
    preferences,
    todayDebtUgx,
    sales,
    todayKey,
    salesIndex,
    staffCatalogTodayCount,
    staffCatalogTodaySensitive,
    refundsTodayCount,
    auditWeekMetrics,
    recentStockAdjustments,
  } = params;
  const resolvedSalesIndex = salesIndex ?? buildSalesDayIndex(sales);
  const base = computeOwnerAlerts({
    products,
    dayCloses,
    auditLogs,
    preferences,
    todayDebtUgx,
    recentStockAdjustments,
  });

  const extra: OwnerAlert[] = [];
  const pct = preferences.cashVarianceThresholdPct ?? 5;
  const fixed = preferences.cashVarianceThresholdUgxFixed ?? 10_000;

  const closeToday = dayCloses.find((d) => d.dateKey === todayKey && !d.supersededAt);
  if (closeToday && closeToday.differenceUgx < 0) {
    const short = -closeToday.differenceUgx;
    const threshold = Math.max((pct / 100) * Math.max(1, closeToday.expectedCashUgx), fixed);
    if (short >= threshold * 0.5) {
      extra.push({
        id: "cash-short-today",
        tone: "warn",
        title: "cashShortTodayTitle",
        detail: "cashShortTodayDetail",
        detailVars: { amount: short.toLocaleString() },
      });
    }
  }

  const yKey = yesterdayKey();
  const todayRev = sumRevenueForDay(resolvedSalesIndex, todayKey);
  const yRev = sumRevenueForDay(resolvedSalesIndex, yKey);
  if (yRev >= 60_000 && todayRev < yRev * 0.55 && todayRev < yRev - 40_000) {
    extra.push({
      id: "sales-soft-today",
      tone: "info",
      title: "salesDroppedTitle",
      detail: "salesDroppedDetail",
      detailVars: {
        today: todayRev.toLocaleString(),
        yesterday: yRev.toLocaleString(),
      },
    });
  }

  const refundsToday =
    refundsTodayCount ?? salesForDay(resolvedSalesIndex, todayKey).filter((s) => s.totalUgx < 0).length;
  if (refundsToday >= 2) {
    extra.push({
      id: "refunds-many",
      tone: "warn",
      title: "manyRefundsTitle",
      detail: "manyRefundsDetail",
      detailVars: { count: String(refundsToday) },
    });
  }

  const cutoff = Date.now() - 14 * 86400000;
  const removesWeek =
    auditWeekMetrics?.productRemoves14d ??
    auditLogs.filter((e) => e.action === "product_remove" && new Date(e.at).getTime() >= cutoff).length;
  if (removesWeek >= 2) {
    extra.push({
      id: "products-removed-review",
      tone: "warn",
      title: "productRemovedReviewTitle",
      detail: "productRemovedReviewDetail",
      detailVars: { count: String(removesWeek) },
    });
  }

  const todayUnits = resolvedSalesIndex.unitsByDayProduct.get(todayKey);
  if (todayUnits) {
    for (const [pid, qtyToday] of todayUnits) {
      if (qtyToday < 4) continue;
      const avg = avgDailyUnitsFromIndex(resolvedSalesIndex, pid, todayKey, 7);
      if (avg >= 0.35 && qtyToday > avg * 2.4) {
        const name = products.find((p) => p.id === pid)?.name ?? pid;
        extra.push({
          id: `fast-burn-${pid}`,
          tone: "info",
          title: "fastBurnTitle",
          detail: "fastBurnDetail",
          titleVars: { product: name },
        });
        break;
      }
    }
  }

  const weekMs = Date.now() - 7 * 86400000;
  const manualStockHits =
    auditWeekMetrics?.manualStockHits7d ??
    auditLogs.filter((e) => {
      if (new Date(e.at).getTime() < weekMs) return false;
      if (e.action !== "stock_adjust") return false;
      const pl = e.payload as Record<string, unknown>;
      const reason = typeof pl.reason === "string" ? pl.reason : "";
      const d = typeof pl.delta === "number" ? pl.delta : 0;
      return d < -15 && /damaged|waste|spoiled|broken|theft|missing|adjust|count/i.test(reason);
    }).length;
  if (manualStockHits >= 4) {
    extra.push({
      id: "manual-stock-review",
      tone: "warn",
      title: "manualStockReviewTitle",
      detail: "manualStockReviewDetail",
    });
  }

  if ((staffCatalogTodayCount ?? 0) > 0) {
    extra.push({
      id: "staff-catalog-today",
      tone: staffCatalogTodaySensitive ? "warn" : "info",
      title: "staffCatalogAlertTitle",
      detail: "staffCatalogAlertDetail",
      detailVars: { count: staffCatalogTodayCount! },
    });
  } else if (staffCatalogTodayCount === undefined) {
    const staffCatalogToday = catalogEventsForDay(auditLogs, todayKey, { nonOwnerOnly: true }).filter(
      (e) => e.action !== "price_change",
    );
    if (staffCatalogToday.length > 0) {
      const sensitive = staffCatalogToday.some(isSensitiveCatalogEvent);
      extra.push({
        id: "staff-catalog-today",
        tone: sensitive ? "warn" : "info",
        title: "staffCatalogAlertTitle",
        detail: "staffCatalogAlertDetail",
        detailVars: { count: staffCatalogToday.length },
      });
    }
  }

  const seen = new Set<string>();
  const merged: OwnerAlert[] = [];
  for (const a of [...extra, ...base]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    merged.push(a);
  }
  return merged;
}
