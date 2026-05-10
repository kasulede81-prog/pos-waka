import type { AuditLogEntry, DayCloseSummary, Product, ShopPreferences } from "../types";
import { isLowStock } from "./sellingEngine";

export type OwnerAlertTone = "info" | "warn" | "danger";

export type OwnerAlert = {
  id: string;
  tone: OwnerAlertTone;
  /** i18n dictionary key */
  title: string;
  /** i18n dictionary key */
  detail: string;
  titleVars?: Record<string, string | number>;
  detailVars?: Record<string, string | number>;
};

/**
 * Friendly, non-technical alerts for the owner dashboard (works fully offline).
 */
export function computeOwnerAlerts(params: {
  products: Product[];
  dayCloses: DayCloseSummary[];
  auditLogs: AuditLogEntry[];
  preferences: ShopPreferences;
  todayDebtUgx: number;
}): OwnerAlert[] {
  const alerts: OwnerAlert[] = [];
  const { products, dayCloses, auditLogs, preferences, todayDebtUgx } = params;
  const pct = preferences.cashVarianceThresholdPct ?? 5;
  const fixed = preferences.cashVarianceThresholdUgxFixed ?? 10_000;

  const low = products.filter((p) => isLowStock(p));
  if (low.length === 1) {
    const p = low[0]!;
    alerts.push({
      id: "low-stock",
      tone: "info",
      title: "singleProductLowTitle",
      detail: "singleProductLowDetail",
      titleVars: { product: p.name },
      detailVars: { stock: String(p.stockOnHand), unit: p.baseUnit },
    });
  } else if (low.length > 1) {
    alerts.push({
      id: "low-stock",
      tone: low.length > 5 ? "warn" : "info",
      title: "multiLowStockTitle",
      detail: "lowStockAlertDetail",
      titleVars: { count: low.length },
    });
  }

  const last = dayCloses[0];
  if (last) {
    const exp = Math.max(1, last.expectedCashUgx);
    const absDiff = Math.abs(last.differenceUgx);
    const threshold = Math.max((pct / 100) * exp, fixed);
    if (absDiff > threshold) {
      alerts.push({
        id: `variance-${last.id}`,
        tone: "danger",
        title: "cashVarianceAlertTitle",
        detail: "cashVarianceAlertDetail",
      });
    }
  }

  if (todayDebtUgx >= 200_000) {
    alerts.push({
      id: "debt-high",
      tone: "warn",
      title: "debtHighAlertTitle",
      detail: "debtHighAlertDetail",
    });
  }

  const recentStock = auditLogs.filter((e) => e.action === "stock_adjust").slice(0, 40);
  let heavyRemoval = 0;
  for (const e of recentStock) {
    const pl = e.payload as Record<string, unknown>;
    const d = typeof pl.delta === "number" ? pl.delta : 0;
    if (d <= -50) heavyRemoval += 1;
  }
  if (heavyRemoval >= 3) {
    alerts.push({
      id: "stock-movements",
      tone: "warn",
      title: "stockRemovalAlertTitle",
      detail: "stockRemovalAlertDetail",
    });
  }

  return alerts;
}
