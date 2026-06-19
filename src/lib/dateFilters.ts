/**
 * Unified Kampala date filtering for receipts, profit, and reports.
 */

import type { CashExpense, ReturnRecord, Sale } from "../types";
import { ACTIVE_SALES_MEMORY_DAYS } from "./activeSalesWindow";
import { dateKeyKampala, monthKeyKampala, saleReportingDayKey, weekStartKeyKampala } from "./datesUg";
import { isRevenueSale } from "./financialMetrics";
import type { RevenueSalesIndex } from "./financialMetrics";

export type DateFilterPreset = "today" | "this_week" | "this_month";

export type DateFilterValue =
  | { kind: "preset"; preset: DateFilterPreset }
  | { kind: "day"; dateKey: string };

export type DateFilterBounds = {
  fromKey: string;
  toKey: string;
  /** True when fromKey === toKey (single calendar day). */
  isSingleDay: boolean;
};

export const DEFAULT_DATE_FILTER: DateFilterValue = { kind: "preset", preset: "today" };

/** @deprecated Use DateFilterValue — kept for monthly report hooks and migrations. */
export type ReportRange = "today" | "week" | "month";

export type ReceiptDateRange = ReportRange;

export function presetToReportRange(preset: DateFilterPreset): ReportRange {
  if (preset === "today") return "today";
  if (preset === "this_week") return "week";
  return "month";
}

export function reportRangeToDateFilter(range: ReportRange): DateFilterValue {
  if (range === "today") return { kind: "preset", preset: "today" };
  if (range === "week") return { kind: "preset", preset: "this_week" };
  return { kind: "preset", preset: "this_month" };
}

export function resolveDateFilterBounds(value: DateFilterValue, now: Date = new Date()): DateFilterBounds {
  const today = dateKeyKampala(now);
  if (value.kind === "day") {
    return { fromKey: value.dateKey, toKey: value.dateKey, isSingleDay: true };
  }
  switch (value.preset) {
    case "today":
      return { fromKey: today, toKey: today, isSingleDay: true };
    case "this_week":
      return { fromKey: weekStartKeyKampala(now), toKey: today, isSingleDay: false };
    case "this_month":
      return { fromKey: `${today.slice(0, 7)}-01`, toKey: today, isSingleDay: false };
  }
}

export function dateMatchesFilter(dateKey: string, bounds: DateFilterBounds): boolean {
  return dateKey >= bounds.fromKey && dateKey <= bounds.toKey;
}

export function saleMatchesFilter(sale: Pick<Sale, "createdAt">, bounds: DateFilterBounds): boolean {
  return dateMatchesFilter(saleReportingDayKey(sale), bounds);
}

export function returnMatchesFilter(ret: Pick<ReturnRecord, "createdAt">, bounds: DateFilterBounds): boolean {
  return dateMatchesFilter(dateKeyKampala(ret.createdAt), bounds);
}

export function expenseMatchesFilter(expense: Pick<CashExpense, "paidOn">, bounds: DateFilterBounds): boolean {
  return dateMatchesFilter(expense.paidOn, bounds);
}

export function revenueSalesInBounds(sales: Sale[], bounds: DateFilterBounds): Sale[] {
  return sales.filter((s) => isRevenueSale(s) && saleMatchesFilter(s, bounds));
}

/** O(days) bucket lookup — avoids rescanning all sales when a day index exists. */
export function revenueSalesInBoundsFromIndex(index: RevenueSalesIndex, bounds: DateFilterBounds): Sale[] {
  if (bounds.isSingleDay) return index.salesByDay.get(bounds.fromKey) ?? [];
  const out: Sale[] = [];
  for (const [dk, list] of index.salesByDay) {
    if (dk >= bounds.fromKey && dk <= bounds.toKey) out.push(...list);
  }
  return out;
}

export function returnsInBounds(returns: ReturnRecord[], bounds: DateFilterBounds): ReturnRecord[] {
  return returns.filter((r) => returnMatchesFilter(r, bounds));
}

/** Active-sales window cutoff (sales older may live in archivedSales). */
export function activeSalesCutoffDateKey(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - ACTIVE_SALES_MEMORY_DAYS);
  return dateKeyKampala(d);
}

export function boundsRequiresArchivedSales(bounds: DateFilterBounds, now: Date = new Date()): boolean {
  return bounds.fromKey < activeSalesCutoffDateKey(now);
}

export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const parts = dateKey.split("-").map(Number);
  const y = parts[0] ?? 2020;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const anchor = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return dateKeyKampala(anchor);
}

export function enumerateDaysInBounds(bounds: DateFilterBounds): string[] {
  const out: string[] = [];
  let cur = bounds.fromKey;
  while (cur <= bounds.toKey) {
    out.push(cur);
    if (cur === bounds.toKey) break;
    cur = addDaysToDateKey(cur, 1);
  }
  return out;
}

/** Legacy receipt range helper — calendar week via weekStartKeyKampala. */
export function saleMatchesReceiptRange(createdAt: string, range: ReceiptDateRange, now: Date = new Date()): boolean {
  const bounds = resolveDateFilterBounds(reportRangeToDateFilter(range), now);
  return dateMatchesFilter(dateKeyKampala(createdAt), bounds);
}

export function monthKeyForFilter(value: DateFilterValue, now: Date = new Date()): string {
  if (value.kind === "day") return value.dateKey.slice(0, 7);
  const bounds = resolveDateFilterBounds(value, now);
  return monthKeyKampala(bounds.toKey);
}
