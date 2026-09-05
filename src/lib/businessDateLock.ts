/**
 * Business date immutability — closed Kampala calendar days are locked until owner reopen.
 */

import type { DayCloseSummary, SyncOperation } from "../types";
import { activeDayCloseForDate } from "./dayCloseIdempotency";
import { dateKeyKampala } from "./datesUg";

export const CLOSED_BUSINESS_DATE_ERROR = "closed_business_date";

export function isClosedBusinessDateSyncError(error?: string | null): boolean {
  return error === CLOSED_BUSINESS_DATE_ERROR || error === "businessDateLocked";
}

/** Parked closed-date queue ops retry only after that date is no longer locked. */
export function shouldRetryClosedBusinessDateOp(
  op: Pick<SyncOperation, "lastError" | "closedDateKey">,
  dayCloses?: DayCloseSummary[],
): boolean {
  if (!isClosedBusinessDateSyncError(op.lastError) || !op.closedDateKey) return true;
  if (dayCloses == null) return false;
  return !isBusinessDateLocked(dayCloses, op.closedDateKey);
}

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
