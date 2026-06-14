import type { AuditLogEntry, DayCloseSummary, Language, Product, Sale, ShopPreferences } from "../types";
import { dateKeyKampala } from "./datesUg";
import { catalogEventsForDay, isSensitiveCatalogEvent } from "./catalogAudit";
import { computeOwnerAlerts, type OwnerAlert } from "./ownerAlerts";
import { t, tTemplate } from "./i18n";
import { actorDisplayLabel } from "./activityNarrative";
import { avgDailyUnitsFromIndex, buildSalesDayIndex, salesForDay, sumRevenueForDay, type SalesDayIndex } from "./salesDayIndex";

export type BusinessPulse = "strong" | "steady" | "watch";

export type CashierTrustLevel = "good" | "warning" | "risky";

export type CashierTrustRow = {
  userId: string;
  displayLabel: string;
  salesHandled: number;
  stockEdits: number;
  debtIssuedUgx: number;
  refundLikeCount: number;
  reliabilityScore: number;
  trustLevel: CashierTrustLevel;
};

export type DailySummaryInput = {
  totalSalesUgx: number;
  estProfitUgx: number;
  debtTodayUgx: number;
  saleCount: number;
  debtSaleCount: number;
  topProductName: string | null;
  lowProductName: string | null;
  cashShortUgx: number | null;
  yesterdaySalesUgx: number;
};

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateKeyKampala(d);
}

function trustLevelFromScore(score: number): CashierTrustLevel {
  if (score >= 72) return "good";
  if (score >= 45) return "warning";
  return "risky";
}

export function computeCashierTrustRows(
  lang: Language,
  todaySales: Sale[],
  auditLogs: AuditLogEntry[],
  todayKey: string,
  todayAuditLogs?: AuditLogEntry[],
): CashierTrustRow[] {
  const byUser = new Map<
    string,
    { sales: number; debt: number; refunds: number; stock: number; catalog: number }
  >();

  const touch = (uid: string) => {
    const id = uid || "unknown";
    byUser.set(id, byUser.get(id) ?? { sales: 0, debt: 0, refunds: 0, stock: 0, catalog: 0 });
    return byUser.get(id)!;
  };

  for (const s of todaySales) {
    const uid = s.soldByUserId ?? "unknown";
    const row = touch(uid);
    row.sales += 1;
    row.debt += s.debtUgx;
    if (s.totalUgx < 0) row.refunds += 1;
  }

  for (const e of todayAuditLogs ?? auditLogs) {
    if (todayAuditLogs == null && dateKeyKampala(e.at) !== todayKey) continue;
    const uid = e.actorUserId || "unknown";
    if (e.action === "stock_adjust") {
      touch(uid).stock += 1;
      continue;
    }
    if (
      e.action === "product_add" ||
      e.action === "product_remove" ||
      e.action === "product_update" ||
      e.action === "price_change"
    ) {
      if (e.role !== "owner") touch(uid).catalog += 1;
    }
  }

  const rows: CashierTrustRow[] = [...byUser.entries()].map(([userId, v]) => {
    let score = 88;
    score -= Math.min(28, v.stock * 4);
    score -= Math.min(18, v.catalog * 3);
    score -= Math.min(22, Math.floor(v.debt / 75_000));
    score -= v.refunds * 18;
    if (v.sales === 0 && (v.stock > 6 || v.catalog > 4)) score -= 12;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const trustLevel = trustLevelFromScore(score);
    return {
      userId,
      displayLabel: actorDisplayLabel(userId, lang),
      salesHandled: v.sales,
      stockEdits: v.stock + v.catalog,
      debtIssuedUgx: v.debt,
      refundLikeCount: v.refunds,
      reliabilityScore: score,
      trustLevel,
    };
  });

  return rows.sort((a, b) => b.salesHandled - a.salesHandled || b.debtIssuedUgx - a.debtIssuedUgx);
}

export function computeBusinessPulse(params: {
  todaySalesUgx: number;
  yesterdaySalesUgx: number;
  alertDangerCount: number;
  alertWarnCount: number;
}): BusinessPulse {
  const { todaySalesUgx, yesterdaySalesUgx, alertDangerCount, alertWarnCount } = params;
  if (alertDangerCount > 0) return "watch";
  if (alertWarnCount >= 2) return "watch";
  if (yesterdaySalesUgx >= 80_000 && todaySalesUgx < yesterdaySalesUgx * 0.55) return "watch";
  if (todaySalesUgx >= yesterdaySalesUgx * 1.05 || todaySalesUgx >= 150_000) return "strong";
  return "steady";
}

export function buildDailyOwnerSummaryLines(lang: Language, input: DailySummaryInput): string[] {
  const lines: string[] = [];
  lines.push(
    tTemplate(lang, "ownerSummarySales", {
      amount: input.totalSalesUgx.toLocaleString(),
    }),
  );
  lines.push(
    tTemplate(lang, "ownerSummaryProfit", {
      amount: input.estProfitUgx.toLocaleString(),
    }),
  );
  if (input.topProductName) {
    lines.push(tTemplate(lang, "ownerSummaryTopProduct", { name: input.topProductName }));
  }
  if (input.lowProductName) {
    lines.push(tTemplate(lang, "ownerSummaryLowStock", { name: input.lowProductName }));
  }
  lines.push(
    tTemplate(lang, "ownerSummaryDebts", {
      count: String(input.debtSaleCount),
      amount: input.debtTodayUgx.toLocaleString(),
    }),
  );
  if (input.cashShortUgx !== null && input.cashShortUgx > 0) {
    lines.push(
      tTemplate(lang, "ownerSummaryCashShort", {
        amount: input.cashShortUgx.toLocaleString(),
      }),
    );
  } else if (input.cashShortUgx === 0) {
    lines.push(t(lang, "ownerSummaryCashOk"));
  }
  return lines;
}

/** Short line for future WhatsApp / SMS push (keep under ~220 chars). */
export function buildWhatsAppOwnerSummaryLine(lang: Language, input: DailySummaryInput): string {
  const parts: string[] = [
    tTemplate(lang, "waSummaryHead", { app: t(lang, "appName") }),
    tTemplate(lang, "waSummarySales", { amount: input.totalSalesUgx.toLocaleString() }),
    tTemplate(lang, "waSummaryProfit", { amount: input.estProfitUgx.toLocaleString() }),
  ];
  if (input.topProductName) parts.push(tTemplate(lang, "waSummaryTop", { name: input.topProductName }));
  if (input.lowProductName) parts.push(tTemplate(lang, "waSummaryLow", { name: input.lowProductName }));
  if (input.cashShortUgx && input.cashShortUgx > 0) {
    parts.push(tTemplate(lang, "waSummaryShort", { amount: input.cashShortUgx.toLocaleString() }));
  }
  return parts.join(" ").slice(0, 220);
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

export function formatVsYesterday(lang: Language, today: number, yesterday: number): string {
  if (yesterday <= 0) return t(lang, "trendNoYesterday");
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  if (pct > 0) return tTemplate(lang, "trendUpPct", { pct: String(pct) });
  if (pct < 0) return tTemplate(lang, "trendDownPct", { pct: String(Math.abs(pct)) });
  return t(lang, "trendFlat");
}
