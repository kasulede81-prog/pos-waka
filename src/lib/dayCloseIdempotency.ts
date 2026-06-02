import type { DayCloseSummary } from "../types";

/** Latest non-superseded close for a Kampala calendar day. */
export function activeDayCloseForDate(
  dayCloses: DayCloseSummary[],
  dateKey: string,
): DayCloseSummary | undefined {
  return dayCloses.find((d) => d.dateKey === dateKey && !d.supersededAt);
}

export function canRecordDayClose(
  dayCloses: DayCloseSummary[],
  dateKey: string,
  override?: boolean,
): { ok: true } | { ok: false; errorKey: "dayCloseAlreadyExists" } {
  const existing = activeDayCloseForDate(dayCloses, dateKey);
  if (existing && !override) return { ok: false, errorKey: "dayCloseAlreadyExists" };
  return { ok: true };
}
