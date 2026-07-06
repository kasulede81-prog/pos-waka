/**
 * Sequential business day rules — prior days with activity must be closed before new operations.
 */

import type { DayCloseSummary, DayDrawerOpen, Sale, ShiftRecord } from "../types";
import { activeDayCloseForDate } from "./dayCloseIdempotency";
import { dateKeyKampala, saleReportingDayKey } from "./datesUg";
import { isCompletedSale } from "./saleStatus";

export function addDaysToDateKey(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 2020, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dateKeyKampala(dt);
}

export function compareDateKeys(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Kampala date keys with recorded activity (sales, shifts, or day drawer open). */
export function businessDaysWithActivity(input: {
  sales: Sale[];
  shifts: ShiftRecord[];
  dayDrawerOpens: DayDrawerOpen[];
  beforeDateKey?: string;
}): Set<string> {
  const days = new Set<string>();
  const cutoff = input.beforeDateKey;

  for (const sale of input.sales) {
    if (!isCompletedSale(sale) && sale.status !== "pending") continue;
    const dk = saleReportingDayKey(sale);
    if (cutoff && compareDateKeys(dk, cutoff) >= 0) continue;
    days.add(dk);
  }
  for (const sale of input.sales) {
    if (sale.status !== "pending") continue;
    const dk = saleReportingDayKey(sale);
    if (cutoff && compareDateKeys(dk, cutoff) >= 0) continue;
    days.add(dk);
  }
  for (const sh of input.shifts) {
    const dk = dateKeyKampala(sh.startAt);
    if (cutoff && compareDateKeys(dk, cutoff) >= 0) continue;
    days.add(dk);
  }
  for (const row of input.dayDrawerOpens) {
    if (row.deletedAt || row.status === "voided") continue;
    if (cutoff && compareDateKeys(row.dateKey, cutoff) >= 0) continue;
    days.add(row.dateKey);
  }
  return days;
}

/** Prior business days that have activity but no active day close. */
export function findUnclosedPriorBusinessDays(input: {
  targetDateKey: string;
  dayCloses: DayCloseSummary[];
  sales: Sale[];
  shifts: ShiftRecord[];
  dayDrawerOpens: DayDrawerOpen[];
}): string[] {
  const active = businessDaysWithActivity({
    sales: input.sales,
    shifts: input.shifts,
    dayDrawerOpens: input.dayDrawerOpens,
    beforeDateKey: input.targetDateKey,
  });
  const unclosed: string[] = [];
  for (const dk of active) {
    if (compareDateKeys(dk, input.targetDateKey) >= 0) continue;
    if (!activeDayCloseForDate(input.dayCloses, dk)) unclosed.push(dk);
  }
  return unclosed.sort(compareDateKeys);
}

/** Later calendar days with an active day drawer open (sequential violation). */
export function findLaterOpenBusinessDays(input: {
  targetDateKey: string;
  dayDrawerOpens: DayDrawerOpen[];
  dayCloses: DayCloseSummary[];
}): string[] {
  const out: string[] = [];
  for (const row of input.dayDrawerOpens) {
    if (row.deletedAt || row.status !== "open") continue;
    if (compareDateKeys(row.dateKey, input.targetDateKey) <= 0) continue;
    if (!activeDayCloseForDate(input.dayCloses, row.dateKey)) out.push(row.dateKey);
  }
  return out.sort(compareDateKeys);
}

export function assertSequentialBusinessDay(input: {
  targetDateKey: string;
  dayCloses: DayCloseSummary[];
  sales: Sale[];
  shifts: ShiftRecord[];
  dayDrawerOpens: DayDrawerOpen[];
}): { ok: true } | { ok: false; errorKey: "sequentialDayBlocked"; unclosedDays: string[] } {
  const unclosed = findUnclosedPriorBusinessDays(input);
  if (unclosed.length > 0) {
    return { ok: false, errorKey: "sequentialDayBlocked", unclosedDays: unclosed };
  }
  return { ok: true };
}

/** Oldest unclosed prior day to close first, else preferred/today. */
export function resolvePrioritizedCloseDateKey(input: {
  preferredDateKey?: string | null;
  todayDateKey: string;
  dayCloses: DayCloseSummary[];
  sales: Sale[];
  shifts: ShiftRecord[];
  dayDrawerOpens: DayDrawerOpen[];
}): string {
  const unclosed = findUnclosedPriorBusinessDays({
    targetDateKey: input.todayDateKey,
    dayCloses: input.dayCloses,
    sales: input.sales,
    shifts: input.shifts,
    dayDrawerOpens: input.dayDrawerOpens,
  });
  if (unclosed.length > 0) {
    const preferred = input.preferredDateKey?.trim();
    if (preferred && unclosed.includes(preferred)) return preferred;
    return unclosed[0]!;
  }
  return input.preferredDateKey?.trim() || input.todayDateKey;
}
