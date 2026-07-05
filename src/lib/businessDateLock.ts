/**
 * Business date immutability — closed Kampala calendar days are locked until owner reopen.
 */

import type { DayCloseSummary } from "../types";
import { activeDayCloseForDate } from "./dayCloseIdempotency";
import { dateKeyKampala } from "./datesUg";

export function isBusinessDateLocked(dayCloses: DayCloseSummary[], dateKey: string): boolean {
  return Boolean(activeDayCloseForDate(dayCloses, dateKey));
}

export function isTodayBusinessDateLocked(dayCloses: DayCloseSummary[]): boolean {
  return isBusinessDateLocked(dayCloses, dateKeyKampala(new Date()));
}

export function assertBusinessDateNotLocked(
  dayCloses: DayCloseSummary[],
  dateKey: string,
): { ok: true } | { ok: false; errorKey: "businessDateLocked" } {
  if (isBusinessDateLocked(dayCloses, dateKey)) {
    return { ok: false, errorKey: "businessDateLocked" };
  }
  return { ok: true };
}

/** Resolve the Kampala business date for a mutation (defaults to today). */
export function resolveMutationBusinessDate(isoOrDate?: string | Date | null): string {
  if (isoOrDate == null) return dateKeyKampala(new Date());
  return dateKeyKampala(isoOrDate);
}
