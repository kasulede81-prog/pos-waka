/**
 * Closed-day historical authority — frozen DayCloseSummary / documentSnapshot
 * wins over live sales/expenses/drawer rebuilds for a closed Kampala date.
 *
 * Late-arriving sales keep their original timestamps and remain in the live
 * ledger. They must not rewrite frozen close totals. Sale-id membership is not
 * on the snapshot today; flagging those rows for reconciliation is CLOSE-DAY-1.2.
 *
 * Snapshot does not persist: payment mix, itemsSold, categories, cashiers,
 * hourly, top products, discounts, voids, or timeline.
 * Closed-day Cash Position must not present live rebuilds of those fields
 * as finalized historical values — strip them (unavailable), do not invent.
 */

import type { CashPositionReport } from "./cashPosition";
import { activeDayCloseForDate } from "./dayCloseIdempotency";
import type { DayCloseSummary } from "../types";
import { getCompletedFinancials } from "./financialMetrics";
import type { Product, ReturnRecord, Sale } from "../types";
import { enumerateDaysInBounds, type DateFilterBounds } from "./dateFilters";

export type ClosedDayAuthoritativeTotals = {
  dateKey: string;
  closeId: string;
  expectedCashUgx: number;
  countedCashUgx: number;
  varianceUgx: number;
  totalSalesUgx: number;
  profitEstimateUgx: number;
  totalDebtUgx: number;
  transactionCount: number | null;
  cashFromSalesUgx: number | null;
  debtCollectedUgx: number | null;
  refundsUgx: number | null;
  expenseUgx: number | null;
  openingFloatUgx: number | null;
  cashSalesUgx: number | null;
  supplierPaymentsUgx: number | null;
  adjustmentInflowsUgx: number | null;
  adjustmentOutflowsUgx: number | null;
  cashRefundsUgx: number | null;
  closedByUserId: string | null;
  closedByLabel: string | null;
  closedAt: string;
};

function n(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function opt(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/** Frozen totals for an active close. Snapshot fields win when present (v2); else the summary row. */
export function readClosedDayTotals(close: DayCloseSummary): ClosedDayAuthoritativeTotals {
  const snap = close.documentSnapshot;
  return {
    dateKey: close.dateKey,
    closeId: close.id,
    expectedCashUgx: n(snap?.expectedCashUgx, close.expectedCashUgx),
    countedCashUgx: n(snap?.countedCashUgx, close.countedCashUgx),
    varianceUgx: n(snap?.varianceUgx, close.differenceUgx),
    totalSalesUgx: n(snap?.totalSalesUgx, close.totalSalesUgx),
    profitEstimateUgx: n(snap?.profitEstimateUgx, close.profitEstimateUgx),
    totalDebtUgx: n(snap?.totalDebtUgx, close.totalDebtUgx),
    transactionCount: opt(snap?.transactionCount),
    cashFromSalesUgx: opt(snap?.cashFromSalesUgx),
    debtCollectedUgx: opt(snap?.debtCollectedUgx),
    refundsUgx: opt(snap?.refundsUgx),
    expenseUgx: opt(snap?.expenseUgx),
    openingFloatUgx: opt(snap?.openingFloatUgx, close.openingFloatUgx),
    cashSalesUgx: opt(snap?.cashSalesUgx, snap?.cashFromSalesUgx),
    supplierPaymentsUgx: opt(snap?.supplierPaymentsUgx),
    adjustmentInflowsUgx: opt(snap?.adjustmentInflowsUgx),
    adjustmentOutflowsUgx: opt(snap?.adjustmentOutflowsUgx),
    cashRefundsUgx: opt(snap?.cashRefundsUgx, snap?.refundsUgx),
    closedByUserId: snap?.closedByUserId ?? close.closedByUserId ?? null,
    closedByLabel: snap?.closedByLabel ?? close.closedByLabel ?? null,
    closedAt: snap?.generatedAt ?? close.createdAt,
  };
}

export function authoritativeCloseForDate(
  dayCloses: DayCloseSummary[] | undefined,
  dateKey: string,
): DayCloseSummary | undefined {
  return activeDayCloseForDate(dayCloses ?? [], dateKey);
}

export type ReportAuthoritySource = "closed_snapshot" | "live";

export type ReportAuthority = {
  closed: boolean;
  dateKey: string;
  snapshot: DayCloseSummary | null;
  frozenTotals: ClosedDayAuthoritativeTotals | null;
  /** Ledger headlines must not use live rebuilds when the date is closed. */
  liveTotalsAllowed: boolean;
  source: ReportAuthoritySource;
};

export type PeriodReportAuthority = "live" | "closed_snapshot" | "mixed";

/** Single resolver for every financial report: closed snapshot or live rebuild. */
export function resolveReportAuthority(
  dayCloses: DayCloseSummary[] | undefined,
  dateKey: string,
): ReportAuthority {
  const snapshot = authoritativeCloseForDate(dayCloses, dateKey) ?? null;
  if (!snapshot) {
    return {
      closed: false,
      dateKey,
      snapshot: null,
      frozenTotals: null,
      liveTotalsAllowed: true,
      source: "live",
    };
  }
  return {
    closed: true,
    dateKey,
    snapshot,
    frozenTotals: readClosedDayTotals(snapshot),
    liveTotalsAllowed: false,
    source: "closed_snapshot",
  };
}

export function resolvePeriodReportAuthority(
  dayCloses: DayCloseSummary[] | undefined,
  bounds: DateFilterBounds,
): PeriodReportAuthority {
  const days = enumerateDaysInBounds(bounds);
  if (days.length === 0) return "live";
  let closed = 0;
  for (const day of days) {
    if (resolveReportAuthority(dayCloses, day).closed) closed += 1;
  }
  if (closed === 0) return "live";
  if (closed === days.length) return "closed_snapshot";
  return "mixed";
}

export function overlayClosedDayTrendPoint(
  dateKey: string,
  live: { revenueUgx: number; transactionCount: number },
  dayCloses?: DayCloseSummary[],
): { revenueUgx: number; transactionCount: number } {
  const frozen = resolveReportAuthority(dayCloses, dateKey).frozenTotals;
  if (!frozen) return live;
  return {
    revenueUgx: frozen.totalSalesUgx,
    transactionCount: frozen.transactionCount ?? live.transactionCount,
  };
}

export function overlayClosedDayExpenses(
  liveExpenseUgx: number,
  dayCloses: DayCloseSummary[] | undefined,
  bounds: DateFilterBounds,
  liveExpenseForDay: (dateKey: string) => number,
): number {
  if (!dayCloses?.length) return liveExpenseUgx;
  let total = liveExpenseUgx;
  const seen = new Set<string>();
  for (const close of dayCloses) {
    if (close.dateKey < bounds.fromKey || close.dateKey > bounds.toKey) continue;
    if (seen.has(close.dateKey)) continue;
    seen.add(close.dateKey);
    const frozenExpense = resolveReportAuthority(dayCloses, close.dateKey).frozenTotals?.expenseUgx;
    if (frozenExpense == null) continue;
    total += frozenExpense - liveExpenseForDay(close.dateKey);
  }
  return total;
}

export function boundsForMonthKey(monthKey: string): DateFilterBounds {
  const parts = monthKey.split("-").map(Number);
  const year = parts[0] ?? 2020;
  const month = parts[1] ?? 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    fromKey: `${monthKey}-01`,
    toKey: `${monthKey}-${String(lastDay).padStart(2, "0")}`,
    isSingleDay: false,
  };
}

/**
 * Closed-date Cash Position: freeze ledger headlines from the close snapshot.
 * Unpersisted operational breakdowns are stripped — never left as live stand-ins.
 */
export function applyClosedDayToCashPositionReport(
  report: CashPositionReport,
  close: DayCloseSummary,
): CashPositionReport {
  const tot = readClosedDayTotals(close);
  return {
    ...report,
    ledgerClosed: true,
    closedDayBreakdownUnavailable: true,
    summary: {
      ...report.summary,
      totalSalesUgx: tot.totalSalesUgx,
      transactionCount: tot.transactionCount ?? report.summary.transactionCount,
      itemsSold: 0,
    },
    paymentMethods: [],
    paymentAdjustmentUgx: 0,
    categories: [],
    cashiers: [],
    cashPosition: {
      ...report.cashPosition,
      openingFloatUgx: tot.openingFloatUgx ?? report.cashPosition.openingFloatUgx,
      cashSalesUgx: tot.cashSalesUgx ?? report.cashPosition.cashSalesUgx,
      debtCollectedUgx: tot.debtCollectedUgx ?? report.cashPosition.debtCollectedUgx,
      adjustmentInflowsUgx: tot.adjustmentInflowsUgx ?? report.cashPosition.adjustmentInflowsUgx,
      adjustmentOutflowsUgx: tot.adjustmentOutflowsUgx ?? report.cashPosition.adjustmentOutflowsUgx,
      refundsUgx: tot.refundsUgx ?? report.cashPosition.refundsUgx,
      cashRefundsUgx: tot.cashRefundsUgx ?? report.cashPosition.cashRefundsUgx,
      expensesUgx: tot.expenseUgx ?? report.cashPosition.expensesUgx,
      supplierPaymentsUgx: tot.supplierPaymentsUgx ?? report.cashPosition.supplierPaymentsUgx,
      expectedCashUgx: tot.expectedCashUgx,
    },
  };
}

export function overlayPeriodFinancials(input: {
  live: {
    revenueUgx: number;
    profitUgx: number;
    transactionCount: number;
    debtIssuedUgx: number;
    cashCollectedUgx?: number;
  };
  dayCloses: DayCloseSummary[];
  bounds: DateFilterBounds;
  sales: Sale[];
  returns: ReturnRecord[];
  products: Product[];
}): {
  revenueUgx: number;
  profitUgx: number;
  transactionCount: number;
  debtIssuedUgx: number;
  cashCollectedUgx: number;
} {
  let revenueUgx = input.live.revenueUgx;
  let profitUgx = input.live.profitUgx;
  let transactionCount = input.live.transactionCount;
  let debtIssuedUgx = input.live.debtIssuedUgx;
  const overlayCash = input.live.cashCollectedUgx != null;
  let cashCollectedUgx = input.live.cashCollectedUgx ?? 0;
  const seen = new Set<string>();

  for (const close of input.dayCloses) {
    if (close.dateKey < input.bounds.fromKey || close.dateKey > input.bounds.toKey) continue;
    if (seen.has(close.dateKey)) continue;
    seen.add(close.dateKey);
    const frozen = resolveReportAuthority(input.dayCloses, close.dateKey).frozenTotals;
    if (!frozen) continue;
    const liveDay = getCompletedFinancials(input.sales, input.returns, input.products, { day: close.dateKey });
    revenueUgx += frozen.totalSalesUgx - liveDay.revenueUgx;
    profitUgx += frozen.profitEstimateUgx - liveDay.profitUgx;
    if (frozen.transactionCount != null) {
      transactionCount += frozen.transactionCount - liveDay.transactionCount;
    }
    debtIssuedUgx += frozen.totalDebtUgx - liveDay.debtIssuedUgx;
    if (overlayCash && frozen.cashFromSalesUgx != null) {
      cashCollectedUgx += frozen.cashFromSalesUgx - liveDay.cashCollectedUgx;
    }
  }

  return { revenueUgx, profitUgx, transactionCount, debtIssuedUgx, cashCollectedUgx };
}

/**
 * Keep frozen snapshot/totals when a pull payload is incomplete or would
 * silently rewrite an existing close. Metadata (supersededAt, updatedAt) may still move.
 */
export function preserveFrozenCloseFields(local: DayCloseSummary, incoming: DayCloseSummary): DayCloseSummary {
  const incomingNewer =
    (Date.parse(incoming.updatedAt ?? incoming.createdAt) || 0) >=
    (Date.parse(local.updatedAt ?? local.createdAt) || 0);
  const meta: DayCloseSummary = incomingNewer
    ? { ...local, ...incoming, pendingSync: false }
    : local;
  const snapshot = local.documentSnapshot ?? incoming.documentSnapshot ?? null;
  const frozen = local.documentSnapshot
    ? local
    : incoming.documentSnapshot
      ? incoming
      : incomingNewer
        ? incoming
        : local;
  return {
    ...meta,
    documentSnapshot: snapshot,
    expectedCashUgx: frozen.expectedCashUgx,
    countedCashUgx: frozen.countedCashUgx,
    differenceUgx: frozen.differenceUgx,
    totalSalesUgx: frozen.totalSalesUgx,
    totalDebtUgx: frozen.totalDebtUgx,
    profitEstimateUgx: frozen.profitEstimateUgx,
    openingFloatUgx: frozen.openingFloatUgx ?? meta.openingFloatUgx,
    closedByUserId: frozen.closedByUserId ?? meta.closedByUserId,
    closedByLabel: frozen.closedByLabel ?? meta.closedByLabel,
  };
}

/** One active close per dateKey — extras are superseded, never deleted. */
export function collapseDuplicateActiveCloses(
  rows: DayCloseSummary[],
  nowIso = new Date().toISOString(),
): DayCloseSummary[] {
  const activeByDate = new Map<string, DayCloseSummary[]>();
  for (const row of rows) {
    if (row.supersededAt) continue;
    const list = activeByDate.get(row.dateKey) ?? [];
    list.push(row);
    activeByDate.set(row.dateKey, list);
  }
  const drop = new Set<string>();
  for (const list of activeByDate.values()) {
    if (list.length <= 1) continue;
    const ranked = [...list].sort((a, b) => {
      const byCreated = (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
      return byCreated !== 0 ? byCreated : b.id.localeCompare(a.id);
    });
    for (const extra of ranked.slice(1)) drop.add(extra.id);
  }
  if (drop.size === 0) return rows;
  return rows.map((row) => (drop.has(row.id) ? { ...row, supersededAt: row.supersededAt ?? nowIso } : row));
}
