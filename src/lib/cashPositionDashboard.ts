/**
 * Cash Position dashboard — range aggregation, timeline, alerts, extended KPIs.
 */

import type {
  CashDrawerAdjustment,
  CashExpense,
  DayCloseSummary,
  DayDrawerOpen,
  DebtPayment,
  Language,
  Product,
  ReturnRecord,
  Sale,
  ShiftRecord,
  StaffAccount,
  SupplierPayment,
} from "../types";
import {
  buildCashPositionReport,
  cashPositionVariance,
  type CashPositionCashierRow,
  type CashPositionCategoryRow,
  type CashPositionPaymentKey,
  type CashPositionReport,
  type CashPositionVariance,
} from "./cashPosition";
import { cashDrawerAdjustmentTypeLabel, isCashDrawerInflow } from "./cashDrawerLedger";
import { physicalCashRefundedFromReturn } from "./cashDrawerSales";
import { expenseCountsInDrawer } from "./cashExpenses";
import { dateKeyKampala } from "./datesUg";
import {
  dateMatchesFilter,
  enumerateDaysInBounds,
  resolveDateFilterBounds,
  type DateFilterBounds,
  type DateFilterValue,
} from "./dateFilters";
import { applyClosedDayToCashPositionReport, overlayPeriodFinancials, readClosedDayTotals, resolveReportAuthority } from "./closedDayAuthority";
import { computeTodayProfitBreakdown } from "./homeProfit";
import { isCompletedSale } from "./saleStatus";
import { t, tTemplate } from "./i18n";

function contentHash(parts: string[]): string {
  let h = 0;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h = (Math.imul(31, h) + part.charCodeAt(i)) | 0;
    }
  }
  return `${parts.length}:${h}`;
}

/** Stable fingerprint for Cash Position dashboard cache invalidation (shop-scoped). */
export function buildCashPositionDashboardFingerprint(input: {
  shopId: string | null | undefined;
  filter: DateFilterValue;
  sales: Array<{ id: string; updatedAt?: string | null; totalUgx?: number; debtUgx?: number; paymentMethod?: string | null }>;
  products: Array<{ id: string; category?: string | null; costPricePerUnitUgx?: number; version?: number; updatedAt?: string }>;
  staffAccounts: Array<{ id: string; name?: string; active?: boolean; linkedAuthUserId?: string | null }>;
  returnRecords: Array<{ id: string; refundAmountUgx?: number; updatedAt?: string | null; createdAt?: string }>;
  debtPayments: Array<{ id: string; amountUgx?: number; createdAt?: string }>;
  cashExpenses: Array<{
    id: string;
    amountUgx?: number;
    approvalStatus?: string | null;
    deletedAt?: string | null;
    paidOn?: string;
  }>;
  supplierPayments: Array<{ id: string; amountUgx?: number; createdAt?: string }>;
  cashDrawerAdjustments: Array<{
    id: string;
    amountUgx?: number;
    type?: string;
    deletedAt?: string | null;
    updatedAt?: string;
  }>;
  dayDrawerOpens: Array<{ id: string; openingFloatUgx?: number; status?: string; updatedAt?: string }>;
  dayCloses: Array<{ id: string; expectedCashUgx?: number; countedCashUgx?: number; supersededAt?: string | null }>;
  shifts: Array<{ id: string; estimatedCashUgx?: number; endAt?: string | null }>;
  formulaVersion: string;
  cashSafeLimitUgx?: number | null;
  lang: string;
  shopName: string;
  generalCategoryLabel: string;
  todayKey: string;
}): string {
  const filterPart =
    input.filter.kind === "preset"
      ? `preset:${input.filter.preset}`
      : input.filter.kind === "day"
        ? `day:${input.filter.dateKey}`
        : `range:${input.filter.fromKey}:${input.filter.toKey}`;
  return [
    `shop:${input.shopId ?? ""}`,
    filterPart,
    contentHash(
      input.sales.map(
        (s) =>
          `${s.id}:${s.updatedAt ?? ""}:${s.totalUgx ?? 0}:${s.debtUgx ?? 0}:${s.paymentMethod ?? ""}`,
      ),
    ),
    contentHash(
      input.products.map(
        (p) =>
          `${p.id}:${p.category ?? ""}:${p.costPricePerUnitUgx ?? 0}:${p.version ?? 0}:${p.updatedAt ?? ""}`,
      ),
    ),
    contentHash(
      input.staffAccounts.map(
        (s) => `${s.id}:${s.name ?? ""}:${s.active === false ? "0" : "1"}:${s.linkedAuthUserId ?? ""}`,
      ),
    ),
    contentHash(
      input.returnRecords.map(
        (r) => `${r.id}:${r.refundAmountUgx ?? 0}:${r.createdAt ?? ""}:${r.updatedAt ?? ""}`,
      ),
    ),
    contentHash(input.debtPayments.map((d) => `${d.id}:${d.amountUgx ?? 0}:${d.createdAt ?? ""}`)),
    contentHash(
      input.cashExpenses.map(
        (e) =>
          `${e.id}:${e.amountUgx ?? 0}:${e.approvalStatus ?? ""}:${e.deletedAt ?? ""}:${e.paidOn ?? ""}`,
      ),
    ),
    contentHash(input.supplierPayments.map((p) => `${p.id}:${p.amountUgx ?? 0}:${p.createdAt ?? ""}`)),
    contentHash(
      input.cashDrawerAdjustments.map(
        (a) => `${a.id}:${a.type ?? ""}:${a.amountUgx ?? 0}:${a.deletedAt ?? ""}:${a.updatedAt ?? ""}`,
      ),
    ),
    contentHash(
      input.dayDrawerOpens.map(
        (o) => `${o.id}:${o.openingFloatUgx ?? 0}:${o.status ?? ""}:${o.updatedAt ?? ""}`,
      ),
    ),
    contentHash(
      input.dayCloses.map(
        (c) =>
          `${c.id}:${c.expectedCashUgx ?? 0}:${c.countedCashUgx ?? 0}:${c.supersededAt ?? ""}`,
      ),
    ),
    contentHash(input.shifts.map((s) => `${s.id}:${s.estimatedCashUgx ?? 0}:${s.endAt ?? ""}`)),
    `fv:${input.formulaVersion}`,
    `safe:${input.cashSafeLimitUgx ?? ""}`,
    `lang:${input.lang}`,
    `shopName:${input.shopName}`,
    `cat:${input.generalCategoryLabel}`,
    `today:${input.todayKey}`,
  ].join("|");
}

export type CashPositionExtendedSummary = CashPositionReport["summary"] & {
  grossProfitUgx: number;
  averageSaleUgx: number;
  largestSaleUgx: number;
  currentDrawerCashUgx: number | null;
};

export type CashPositionCategoryDetail = CashPositionCategoryRow & {
  itemsSold: number;
  products: Array<{ productId: string; name: string; qty: number; amountUgx: number }>;
};

export type CashPositionCashierDetail = CashPositionCashierRow & {
  refundsUgx: number;
  netSalesUgx: number;
  averageSaleUgx: number;
  rank: number;
};

export type CashActivityKind =
  | "opening"
  | "sale"
  | "debt"
  | "expense"
  | "refund"
  | "supplier"
  | "adjustment";

export type CashActivityEvent = {
  id: string;
  at: string;
  timeLabel: string;
  label: string;
  amountUgx: number;
  kind: CashActivityKind;
};

export type CashPositionAlertSeverity = "warning" | "info" | "critical";

export type CashPositionAlert = {
  id: string;
  severity: CashPositionAlertSeverity;
  message: string;
};

export type CashPositionDashboardInput = {
  lang: Language;
  filter: DateFilterValue;
  shopName: string;
  sales: Sale[];
  products: Product[];
  returnRecords: ReturnRecord[];
  debtPayments: DebtPayment[];
  cashExpenses: CashExpense[];
  supplierPayments: SupplierPayment[];
  cashDrawerAdjustments: CashDrawerAdjustment[];
  shifts: ShiftRecord[];
  dayDrawerOpens: DayDrawerOpen[];
  dayCloses: DayCloseSummary[];
  formulaVersion: import("../types").CashDrawerFormulaVersion;
  staffAccounts: StaffAccount[];
  generalCategoryLabel: string;
  cashSafeLimitUgx?: number | null;
  todayKey?: string;
};

export type CashPositionDashboardResult = {
  bounds: DateFilterBounds;
  isSingleDay: boolean;
  isToday: boolean;
  rangeLabel: string;
  report: CashPositionReport;
  extendedSummary: CashPositionExtendedSummary;
  categories: CashPositionCategoryDetail[];
  cashiers: CashPositionCashierDetail[];
  timeline: CashActivityEvent[];
  alerts: CashPositionAlert[];
  drawerStatus: {
    expectedCashUgx: number;
    countedCashUgx: number | null;
    varianceUgx: number | null;
    kind: CashPositionVariance | null;
  } | null;
  previousCounts: Array<{
    dateKey: string;
    countedCashUgx: number;
    differenceUgx: number;
    kind: CashPositionVariance;
  }>;
  safeLimit: {
    limitUgx: number | null;
    currentCashUgx: number;
    remainingUgx: number | null;
    exceeded: boolean;
  };
};

const PAYMENT_KEYS: CashPositionPaymentKey[] = [
  "cash",
  "mobile_money",
  "card",
  "bank_transfer",
  "credit",
];

function mergePaymentMethods(reports: CashPositionReport[]): CashPositionReport["paymentMethods"] {
  const agg = new Map<CashPositionPaymentKey, { amountUgx: number; transactionCount: number }>();
  for (const key of PAYMENT_KEYS) agg.set(key, { amountUgx: 0, transactionCount: 0 });
  let totalSales = 0;
  for (const r of reports) {
    totalSales += r.summary.totalSalesUgx;
    for (const row of r.paymentMethods) {
      const cur = agg.get(row.key)!;
      agg.set(row.key, {
        amountUgx: cur.amountUgx + row.amountUgx,
        transactionCount: cur.transactionCount + row.transactionCount,
      });
    }
  }
  return PAYMENT_KEYS.map((key) => {
    const row = agg.get(key)!;
    return {
      key,
      amountUgx: row.amountUgx,
      percent: totalSales > 0 ? Math.round((row.amountUgx / totalSales) * 1000) / 10 : 0,
      transactionCount: row.transactionCount,
    };
  }).filter((row) => row.amountUgx > 0 || row.transactionCount > 0);
}

function mergeCategories(reports: CashPositionReport[]): CashPositionCategoryRow[] {
  const agg = new Map<string, { label: string; amountUgx: number }>();
  let totalSales = 0;
  for (const r of reports) {
    totalSales += r.summary.totalSalesUgx;
    for (const c of r.categories) {
      const cur = agg.get(c.categoryKey) ?? { label: c.categoryLabel, amountUgx: 0 };
      agg.set(c.categoryKey, { label: c.categoryLabel, amountUgx: cur.amountUgx + c.amountUgx });
    }
  }
  return [...agg.entries()]
    .map(([categoryKey, row]) => ({
      categoryKey,
      categoryLabel: row.label,
      amountUgx: row.amountUgx,
      percent: totalSales > 0 ? Math.round((row.amountUgx / totalSales) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amountUgx - a.amountUgx);
}

function mergeCashiers(reports: CashPositionReport[]): CashPositionCashierRow[] {
  const agg = new Map<string, CashPositionCashierRow>();
  for (const r of reports) {
    for (const c of r.cashiers) {
      const cur = agg.get(c.cashierId);
      if (cur) {
        cur.salesUgx += c.salesUgx;
        cur.transactionCount += c.transactionCount;
      } else {
        agg.set(c.cashierId, { ...c });
      }
    }
  }
  return [...agg.values()].sort((a, b) => b.salesUgx - a.salesUgx);
}

function aggregateReports(reports: CashPositionReport[], bounds: DateFilterBounds): CashPositionReport {
  if (reports.length === 1) return reports[0]!;
  const first = reports[0]!;
  const last = reports[reports.length - 1]!;
  const summary = reports.reduce(
    (acc, r) => ({
      totalSalesUgx: acc.totalSalesUgx + r.summary.totalSalesUgx,
      transactionCount: acc.transactionCount + r.summary.transactionCount,
      itemsSold: acc.itemsSold + r.summary.itemsSold,
    }),
    { totalSalesUgx: 0, transactionCount: 0, itemsSold: 0 },
  );
  const cashAgg = reports.reduce(
    (acc, r) => ({
      openingFloatUgx: acc.openingFloatUgx + r.cashPosition.openingFloatUgx,
      cashSalesUgx: acc.cashSalesUgx + r.cashPosition.cashSalesUgx,
      debtCollectedUgx: acc.debtCollectedUgx + r.cashPosition.debtCollectedUgx,
      adjustmentInflowsUgx: acc.adjustmentInflowsUgx + r.cashPosition.adjustmentInflowsUgx,
      adjustmentOutflowsUgx: acc.adjustmentOutflowsUgx + r.cashPosition.adjustmentOutflowsUgx,
      refundsUgx: acc.refundsUgx + r.cashPosition.refundsUgx,
      cashRefundsUgx: acc.cashRefundsUgx + r.cashPosition.cashRefundsUgx,
      expensesUgx: acc.expensesUgx + r.cashPosition.expensesUgx,
      supplierPaymentsUgx: acc.supplierPaymentsUgx + r.cashPosition.supplierPaymentsUgx,
      expectedCashUgx: null as number | null,
    }),
    {
      openingFloatUgx: 0,
      cashSalesUgx: 0,
      debtCollectedUgx: 0,
      adjustmentInflowsUgx: 0,
      adjustmentOutflowsUgx: 0,
      refundsUgx: 0,
      cashRefundsUgx: 0,
      expensesUgx: 0,
      supplierPaymentsUgx: 0,
      expectedCashUgx: null as number | null,
    },
  );
  const paymentAdjustmentUgx = reports.reduce((s, r) => s + r.paymentAdjustmentUgx, 0);
  const adjustmentBreakdown = { ...first.adjustmentBreakdown };
  for (let i = 1; i < reports.length; i++) {
    const r = reports[i]!;
    for (const [type, amount] of Object.entries(r.adjustmentBreakdown)) {
      const k = type as keyof typeof adjustmentBreakdown;
      adjustmentBreakdown[k] = (adjustmentBreakdown[k] ?? 0) + (amount ?? 0);
    }
  }
  return {
    dayKey: bounds.isSingleDay ? first.dayKey : `${bounds.fromKey}…${bounds.toKey}`,
    shopName: first.shopName,
    generatedAt: new Date().toISOString(),
    summary,
    paymentMethods: mergePaymentMethods(reports),
    paymentAdjustmentUgx,
    cashPosition: {
      ...cashAgg,
      // Day-scoped drawer balance is not meaningful across a multi-day range.
      expectedCashUgx: bounds.isSingleDay ? last.cashPosition.expectedCashUgx : null,
    },
    adjustmentBreakdown,
    categories: mergeCategories(reports),
    cashiers: mergeCashiers(reports),
    ledgerClosed: reports.some((r) => r.ledgerClosed),
    closedDayBreakdownUnavailable: reports.every((r) => r.closedDayBreakdownUnavailable),
  };
}

function formatTimeKampala(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "";
  }
}

export function buildCashActivityTimeline(input: {
  lang: Language;
  bounds: DateFilterBounds;
  sales: Sale[];
  returnRecords: ReturnRecord[];
  debtPayments: DebtPayment[];
  cashExpenses: CashExpense[];
  supplierPayments: SupplierPayment[];
  cashDrawerAdjustments: CashDrawerAdjustment[];
  dayDrawerOpens: DayDrawerOpen[];
}): CashActivityEvent[] {
  const events: CashActivityEvent[] = [];

  for (const open of input.dayDrawerOpens) {
    if (!dateMatchesFilter(open.dateKey, input.bounds) || open.status === "voided") continue;
    events.push({
      id: `open-${open.id}`,
      at: open.createdAt,
      timeLabel: formatTimeKampala(open.createdAt),
      label: t(input.lang, "cashPositionOpeningFloat"),
      amountUgx: open.openingFloatUgx,
      kind: "opening",
    });
  }

  for (const sale of input.sales) {
    if (!isCompletedSale(sale)) continue;
    const dk = dateKeyKampala(sale.createdAt);
    if (!dateMatchesFilter(dk, input.bounds)) continue;
    const cashPart =
      sale.paymentMethod === "mobile_money" || sale.paymentMethod === "atm"
        ? 0
        : Math.max(0, sale.totalUgx - Math.max(0, sale.debtUgx));
    if (cashPart > 0) {
      events.push({
        id: `sale-${sale.id}`,
        at: sale.createdAt,
        timeLabel: formatTimeKampala(sale.createdAt),
        label: t(input.lang, "cashPositionTimelineSale"),
        amountUgx: cashPart,
        kind: "sale",
      });
    }
  }

  for (const dp of input.debtPayments) {
    const dk = dateKeyKampala(dp.createdAt);
    if (!dateMatchesFilter(dk, input.bounds)) continue;
    events.push({
      id: `debt-${dp.id}`,
      at: dp.createdAt,
      timeLabel: formatTimeKampala(dp.createdAt),
      label: t(input.lang, "cashPositionDebtCollected"),
      amountUgx: dp.amountUgx,
      kind: "debt",
    });
  }

  for (const exp of input.cashExpenses) {
    if (!expenseCountsInDrawer(exp)) continue;
    if (!dateMatchesFilter(exp.paidOn, input.bounds)) continue;
    events.push({
      id: `exp-${exp.id}`,
      at: exp.createdAt,
      timeLabel: formatTimeKampala(exp.createdAt),
      label: exp.category ? `${t(input.lang, "cashPositionExpenses")} · ${exp.category}` : t(input.lang, "cashPositionExpenses"),
      amountUgx: -Math.max(0, exp.amountUgx),
      kind: "expense",
    });
  }

  for (const sp of input.supplierPayments) {
    const dk = dateKeyKampala(sp.createdAt);
    if (!dateMatchesFilter(dk, input.bounds)) continue;
    events.push({
      id: `sup-${sp.id}`,
      at: sp.createdAt,
      timeLabel: formatTimeKampala(sp.createdAt),
      label: t(input.lang, "cashPositionSupplierPayments"),
      amountUgx: -Math.max(0, sp.amountUgx),
      kind: "supplier",
    });
  }

  for (const ret of input.returnRecords) {
    const dk = dateKeyKampala(ret.createdAt);
    if (!dateMatchesFilter(dk, input.bounds)) continue;
    const sameDaySaleIds = new Set(
      input.sales
        .filter((s) => isCompletedSale(s) && dateKeyKampala(s.createdAt) === dk)
        .map((s) => s.id),
    );
    if (ret.saleId && sameDaySaleIds.has(ret.saleId)) continue;
    const cashOut = physicalCashRefundedFromReturn(ret);
    if (cashOut <= 0) continue;
    events.push({
      id: `ret-${ret.id}`,
      at: ret.createdAt,
      timeLabel: formatTimeKampala(ret.createdAt),
      label: t(input.lang, "cashPositionRefunds"),
      amountUgx: -cashOut,
      kind: "refund",
    });
  }

  for (const adj of input.cashDrawerAdjustments) {
    if (adj.deletedAt) continue;
    const dk = dateKeyKampala(adj.occurredAt);
    if (!dateMatchesFilter(dk, input.bounds)) continue;
    const signed = isCashDrawerInflow(adj.type)
      ? Math.max(0, adj.amountUgx)
      : -Math.max(0, adj.amountUgx);
    events.push({
      id: `adj-${adj.id}`,
      at: adj.occurredAt,
      timeLabel: formatTimeKampala(adj.occurredAt),
      label: cashDrawerAdjustmentTypeLabel(input.lang, adj.type),
      amountUgx: signed,
      kind: "adjustment",
    });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}

function buildCategoryDetails(
  report: CashPositionReport,
  sales: Sale[],
  products: Product[],
  bounds: DateFilterBounds,
): CashPositionCategoryDetail[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const uncategorized = "__uncategorized__";
  const detailMap = new Map<string, CashPositionCategoryDetail>();

  for (const row of report.categories) {
    detailMap.set(row.categoryKey, {
      ...row,
      itemsSold: 0,
      products: [],
    });
  }

  const productAgg = new Map<string, Map<string, { productId: string; name: string; qty: number; amountUgx: number }>>();

  for (const sale of sales) {
    if (!isCompletedSale(sale)) continue;
    const dk = dateKeyKampala(sale.createdAt);
    if (!dateMatchesFilter(dk, bounds)) continue;
    for (const line of sale.lines) {
      if (line.voided) continue;
      const p = productById.get(line.productId);
      const catRaw = p?.category?.trim() ?? "";
      const categoryKey = catRaw.length > 0 ? catRaw : uncategorized;
      const detail = detailMap.get(categoryKey);
      if (detail) detail.itemsSold += line.quantity;
      const catProducts = productAgg.get(categoryKey) ?? new Map();
      const cur = catProducts.get(line.productId) ?? {
        productId: line.productId,
        name: line.name,
        qty: 0,
        amountUgx: 0,
      };
      catProducts.set(line.productId, {
        productId: line.productId,
        name: line.name,
        qty: cur.qty + line.quantity,
        amountUgx: cur.amountUgx + line.lineTotalUgx,
      });
      productAgg.set(categoryKey, catProducts);
    }
  }

  return [...detailMap.values()].map((d) => ({
    ...d,
    products: [...(productAgg.get(d.categoryKey)?.values() ?? [])].sort((a, b) => b.amountUgx - a.amountUgx),
  }));
}

function buildCashierDetails(
  report: CashPositionReport,
  returnRecords: ReturnRecord[],
  bounds: DateFilterBounds,
): CashPositionCashierDetail[] {
  const refundsByCashier = new Map<string, number>();
  for (const ret of returnRecords) {
    const dk = dateKeyKampala(ret.createdAt);
    if (!dateMatchesFilter(dk, bounds)) continue;
    const uid = ret.actorUserId ?? "unknown";
    refundsByCashier.set(uid, (refundsByCashier.get(uid) ?? 0) + Math.max(0, ret.refundAmountUgx));
  }

  return report.cashiers.map((row, idx) => {
    const refundsUgx = refundsByCashier.get(row.cashierId) ?? 0;
    // salesUgx already reflects linked same-day returns on sale.totalUgx; do not subtract again.
    // External refunds remain informational via refundsUgx (canonical revenue subtracts those once at day level).
    const netSalesUgx = Math.max(0, row.salesUgx);
    const averageSaleUgx =
      row.transactionCount > 0 ? Math.round(row.salesUgx / row.transactionCount) : 0;
    return {
      ...row,
      refundsUgx,
      netSalesUgx,
      averageSaleUgx,
      rank: idx + 1,
    };
  });
}

export function buildCashPositionAlerts(input: {
  lang: Language;
  report: CashPositionReport;
  bounds: DateFilterBounds;
  isToday: boolean;
  dayCloses: DayCloseSummary[];
  todayKey: string;
  cashSafeLimitUgx?: number | null;
  returnRecords: ReturnRecord[];
  cashDrawerAdjustments: CashDrawerAdjustment[];
  pendingDebtCount: number;
}): CashPositionAlert[] {
  const alerts: CashPositionAlert[] = [];
  if (!input.isToday || !input.bounds.isSingleDay) return alerts;

  const activeClose = resolveReportAuthority(input.dayCloses, input.todayKey).snapshot;
  if (!activeClose) {
    alerts.push({
      id: "drawer-not-counted",
      severity: "warning",
      message: t(input.lang, "cashPositionAlertDrawerNotCounted"),
    });
  }

  const todayReturns = input.returnRecords.filter(
    (r) => dateKeyKampala(r.createdAt) === input.todayKey,
  );
  const refundTotal = todayReturns.reduce((s, r) => s + Math.max(0, r.refundAmountUgx), 0);
  if (refundTotal > 0 && refundTotal >= input.report.summary.totalSalesUgx * 0.15) {
    alerts.push({
      id: "high-refunds",
      severity: "warning",
      message: t(input.lang, "cashPositionAlertHighRefunds"),
    });
  }

  const expected = input.report.cashPosition.expectedCashUgx;
  if (
    expected != null &&
    input.cashSafeLimitUgx != null &&
    input.cashSafeLimitUgx > 0 &&
    expected > input.cashSafeLimitUgx
  ) {
    alerts.push({
      id: "safe-limit",
      severity: "warning",
      message: tTemplate(input.lang, "cashPositionAlertSafeLimit", {
        amount: (expected - input.cashSafeLimitUgx).toLocaleString(),
      }),
    });
  }

  const largeWithdrawal = input.cashDrawerAdjustments
    .filter((a) => !a.deletedAt && dateKeyKampala(a.occurredAt) === input.todayKey)
    .filter((a) => a.type === "owner_withdrawal" || a.type === "bank_deposit" || a.type === "cash_removed")
    .find((a) => a.amountUgx >= 500_000);
  if (largeWithdrawal) {
    alerts.push({
      id: "large-withdrawal",
      severity: "info",
      message: t(input.lang, "cashPositionAlertLargeWithdrawal"),
    });
  }

  if (input.pendingDebtCount > 0) {
    alerts.push({
      id: "pending-debt",
      severity: "info",
      message: tTemplate(input.lang, "cashPositionAlertPendingDebt", { count: input.pendingDebtCount }),
    });
  }

  if (expected != null && expected < 0) {
    alerts.push({
      id: "negative-cash",
      severity: "critical",
      message: t(input.lang, "cashPositionAlertNegativeCash"),
    });
  }

  return alerts;
}

export function buildCashPositionDashboard(input: CashPositionDashboardInput): CashPositionDashboardResult {
  const todayKey = input.todayKey ?? dateKeyKampala(new Date());
  const bounds = resolveDateFilterBounds(input.filter);
  const isToday = bounds.isSingleDay && bounds.fromKey === todayKey;
  const days = enumerateDaysInBounds(bounds);

  const reports = days.map((dayKey) => {
    const live = buildCashPositionReport({
      lang: input.lang,
      dayKey,
      shopName: input.shopName,
      sales: input.sales,
      products: input.products,
      returnRecords: input.returnRecords,
      debtPayments: input.debtPayments,
      cashExpenses: input.cashExpenses,
      supplierPayments: input.supplierPayments,
      cashDrawerAdjustments: input.cashDrawerAdjustments,
      shifts: input.shifts,
      dayDrawerOpens: input.dayDrawerOpens,
      formulaVersion: input.formulaVersion,
      staffAccounts: input.staffAccounts,
      generalCategoryLabel: input.generalCategoryLabel,
    });
    const auth = resolveReportAuthority(input.dayCloses, dayKey);
    return auth.snapshot ? applyClosedDayToCashPositionReport(live, auth.snapshot) : live;
  });
  const report = aggregateReports(reports, bounds);

  const scopedSales = input.sales.filter((s) => {
    if (!isCompletedSale(s)) return false;
    return dateMatchesFilter(dateKeyKampala(s.createdAt), bounds);
  });
  const scopedReturns = input.returnRecords.filter((r) =>
    dateMatchesFilter(dateKeyKampala(r.createdAt), bounds),
  );
  const profit = computeTodayProfitBreakdown(
    scopedSales,
    new Map(input.products.map((p) => [p.id, p])),
    scopedReturns,
  );
  const singleClose = bounds.isSingleDay
    ? resolveReportAuthority(input.dayCloses, bounds.fromKey).snapshot
    : undefined;
  const periodProfit = overlayPeriodFinancials({
    live: {
      revenueUgx: 0,
      profitUgx: profit.profitUgx,
      transactionCount: 0,
      debtIssuedUgx: 0,
    },
    dayCloses: input.dayCloses,
    bounds,
    sales: input.sales,
    returns: input.returnRecords,
    products: input.products,
  });
  const closedSingleDay = Boolean(singleClose);
  const largestSaleUgx = closedSingleDay
    ? 0
    : scopedSales.reduce((max, s) => Math.max(max, s.totalUgx), 0);
  const averageSaleUgx =
    report.summary.transactionCount > 0
      ? Math.round(report.summary.totalSalesUgx / report.summary.transactionCount)
      : 0;

  const extendedSummary: CashPositionExtendedSummary = {
    ...report.summary,
    grossProfitUgx: singleClose ? readClosedDayTotals(singleClose).profitEstimateUgx : periodProfit.profitUgx,
    averageSaleUgx,
    largestSaleUgx,
    currentDrawerCashUgx:
      (isToday || Boolean(singleClose)) && report.cashPosition.expectedCashUgx != null
        ? report.cashPosition.expectedCashUgx
        : null,
  };

  const categories = closedSingleDay ? [] : buildCategoryDetails(report, input.sales, input.products, bounds);
  const cashiers = closedSingleDay ? [] : buildCashierDetails(report, input.returnRecords, bounds);

  const timeline = closedSingleDay
    ? []
    : buildCashActivityTimeline({
        lang: input.lang,
        bounds,
        sales: input.sales,
        returnRecords: input.returnRecords,
        debtPayments: input.debtPayments,
        cashExpenses: input.cashExpenses,
        supplierPayments: input.supplierPayments,
        cashDrawerAdjustments: input.cashDrawerAdjustments,
        dayDrawerOpens: input.dayDrawerOpens,
      });

  const pendingDebtCount = input.sales.filter(
    (s) => isCompletedSale(s) && (s.debtUgx ?? 0) > 0,
  ).length;

  const alerts = buildCashPositionAlerts({
    lang: input.lang,
    report,
    bounds,
    isToday,
    dayCloses: input.dayCloses,
    todayKey,
    cashSafeLimitUgx: input.cashSafeLimitUgx,
    returnRecords: input.returnRecords,
    cashDrawerAdjustments: input.cashDrawerAdjustments,
    pendingDebtCount,
  });

  let drawerStatus: CashPositionDashboardResult["drawerStatus"] = null;
  if (bounds.isSingleDay && report.cashPosition.expectedCashUgx != null) {
    const activeClose = resolveReportAuthority(input.dayCloses, bounds.fromKey).snapshot;
    const expectedCashUgx = report.cashPosition.expectedCashUgx;
    const countedCashUgx = activeClose ? readClosedDayTotals(activeClose).countedCashUgx : null;
    const variance =
      countedCashUgx != null ? cashPositionVariance(expectedCashUgx, countedCashUgx) : null;
    if (activeClose || isToday) {
      drawerStatus = {
        expectedCashUgx,
        countedCashUgx,
        varianceUgx: variance?.varianceUgx ?? null,
        kind: variance?.kind ?? null,
      };
    }
  }

  const previousCounts = input.dayCloses
    .filter((d) => !d.supersededAt && d.dateKey !== todayKey)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .slice(0, 7)
    .map((d) => {
      const v = cashPositionVariance(d.expectedCashUgx, d.countedCashUgx);
      return {
        dateKey: d.dateKey,
        countedCashUgx: d.countedCashUgx,
        differenceUgx: d.differenceUgx,
        kind: v.kind,
      };
    });

  const currentCashUgx =
    isToday && report.cashPosition.expectedCashUgx != null ? report.cashPosition.expectedCashUgx : 0;
  const limit = input.cashSafeLimitUgx ?? null;
  const safeLimit = {
    limitUgx: limit,
    currentCashUgx,
    remainingUgx: limit != null && limit > 0 ? Math.max(0, limit - currentCashUgx) : null,
    exceeded: limit != null && limit > 0 && currentCashUgx > limit,
  };

  const rangeLabel = bounds.isSingleDay
    ? bounds.fromKey
    : `${bounds.fromKey} → ${bounds.toKey}`;

  return {
    bounds,
    isSingleDay: bounds.isSingleDay,
    isToday,
    rangeLabel,
    report,
    extendedSummary,
    categories,
    cashiers,
    timeline,
    alerts,
    drawerStatus,
    previousCounts,
    safeLimit,
  };
}
