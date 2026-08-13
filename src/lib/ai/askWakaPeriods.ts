/**
 * Ask WAKA calendar periods in the POS business timezone.
 * Monday-start weeks, matching `weekStartKeyKampala` / Africa/Kampala.
 *
 * Existing reporting RPCs remain authoritative for totals.
 * `shop_get_weekly_sales_summary(p_anchor_day)` is a 7-day window ending on
 * the anchor. Passing the calendar week's Sunday therefore yields Mon–Sun.
 */

export const ASK_WAKA_TIME_ZONE = "Africa/Kampala";
/** Monday. Matches src/lib/datesUg.ts weekStartKeyKampala. */
export const ASK_WAKA_WEEK_STARTS_ON = 1;

export type AskWakaWeekScope = "this" | "last";

export type AskWakaPeriod = {
  start_day: string;
  end_day: string;
  label: string;
  in_progress: boolean;
  week_scope?: AskWakaWeekScope;
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const KAMPALA_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: ASK_WAKA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const SHORT_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});

export function isAskWakaYmd(value: string): boolean {
  return YMD_RE.test(value);
}

export function kampalaToday(now: Date = new Date()): string {
  return KAMPALA_YMD.format(now);
}

export function ymdToUtcNoon(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
}

export function addDaysYmd(ymd: string, days: number): string {
  const dt = ymdToUtcNoon(ymd);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Monday (YYYY-MM-DD) of the Kampala calendar week containing `ymd`. */
export function mondayOfKampalaWeek(ymd: string): string {
  const anchor = ymdToUtcNoon(ymd);
  const mondayOffset = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - mondayOffset);
  return anchor.toISOString().slice(0, 10);
}

export function sundayOfKampalaWeek(ymd: string): string {
  return addDaysYmd(mondayOfKampalaWeek(ymd), 6);
}

export function formatAskWakaDayShort(ymd: string): string {
  return SHORT_DAY.format(ymdToUtcNoon(ymd));
}

export function formatAskWakaRangeShort(startDay: string, endDay: string): string {
  return `${formatAskWakaDayShort(startDay)}–${formatAskWakaDayShort(endDay)}`;
}

function periodLabel(kind: "this" | "last" | "rolling", period: Omit<AskWakaPeriod, "label">): string {
  const range = formatAskWakaRangeShort(period.start_day, period.end_day);
  if (kind === "rolling") return `Last 7 days (${range})`;
  const head = kind === "last" ? "Last week" : "This week";
  if (period.in_progress) return `${head} (${range}, in progress)`;
  return `${head} (${range})`;
}

export function calendarWeekContaining(ymd: string, todayYmd: string): AskWakaPeriod {
  const start_day = mondayOfKampalaWeek(ymd);
  const end_day = addDaysYmd(start_day, 6);
  const in_progress = todayYmd >= start_day && todayYmd <= end_day;
  const base = { start_day, end_day, in_progress };
  return { ...base, label: periodLabel("this", base) };
}

export function thisCalendarWeek(now: Date = new Date()): AskWakaPeriod {
  const today = kampalaToday(now);
  const start_day = mondayOfKampalaWeek(today);
  const end_day = addDaysYmd(start_day, 6);
  const base = { start_day, end_day, in_progress: true, week_scope: "this" as const };
  return { ...base, label: periodLabel("this", base) };
}

export function lastCalendarWeek(now: Date = new Date()): AskWakaPeriod {
  const today = kampalaToday(now);
  const thisMonday = mondayOfKampalaWeek(today);
  const start_day = addDaysYmd(thisMonday, -7);
  const end_day = addDaysYmd(start_day, 6);
  const base = { start_day, end_day, in_progress: false, week_scope: "last" as const };
  return { ...base, label: periodLabel("last", base) };
}

export function consecutiveCalendarWeeks(now: Date = new Date()): {
  thisWeek: AskWakaPeriod;
  lastWeek: AskWakaPeriod;
} {
  return { thisWeek: thisCalendarWeek(now), lastWeek: lastCalendarWeek(now) };
}

/** True when last week ends the day before this week starts, with no overlap. */
export function weeksAreConsecutive(lastWeek: AskWakaPeriod, thisWeek: AskWakaPeriod): boolean {
  if (lastWeek.end_day >= thisWeek.start_day) return false;
  if (thisWeek.start_day <= lastWeek.start_day) return false;
  return addDaysYmd(lastWeek.end_day, 1) === thisWeek.start_day;
}

export function weeksHaveNoOverlap(a: AskWakaPeriod, b: AskWakaPeriod): boolean {
  return a.end_day < b.start_day || b.end_day < a.start_day;
}

export function weeksHaveNoGap(lastWeek: AskWakaPeriod, thisWeek: AskWakaPeriod): boolean {
  return addDaysYmd(lastWeek.end_day, 1) === thisWeek.start_day;
}

export function resolveAskWakaWeekScope(raw: unknown): AskWakaWeekScope {
  return String(raw ?? "this").toLowerCase() === "last" ? "last" : "this";
}

export function periodForWeekScope(scope: AskWakaWeekScope, now: Date = new Date()): AskWakaPeriod {
  return scope === "last" ? lastCalendarWeek(now) : thisCalendarWeek(now);
}

/** Server-resolved week fields. Model date arguments must not override these. */
export function calendarWeekToolArgs(week: unknown, now: Date = new Date()): {
  start_day: string;
  end_day: string;
  week: AskWakaWeekScope;
  period_label: string;
  in_progress: boolean;
  anchor_day: string;
} {
  const period = periodForWeekScope(resolveAskWakaWeekScope(week), now);
  return {
    start_day: period.start_day,
    end_day: period.end_day,
    week: period.week_scope ?? "this",
    period_label: period.label,
    in_progress: period.in_progress,
    anchor_day: period.end_day,
  };
}

/** Existing expense RPC week is rolling 7 days ending today — label it honestly. */
export function rollingSevenDayPeriod(now: Date = new Date()): AskWakaPeriod {
  const end_day = kampalaToday(now);
  const start_day = addDaysYmd(end_day, -6);
  const base = { start_day, end_day, in_progress: false };
  return { ...base, label: periodLabel("rolling", base) };
}

export function zeroSalesConfirmed(revenueUgx: unknown, transactionCount: unknown): boolean {
  const revenue = Number(revenueUgx ?? 0);
  const tx = Number(transactionCount ?? 0);
  return Number.isFinite(revenue) && Number.isFinite(tx) && revenue === 0 && tx === 0;
}

export function weekChange(thisRevenue: number, lastRevenue: number): {
  change_ugx: number;
  change_pct: number | null;
} {
  const change_ugx = thisRevenue - lastRevenue;
  if (lastRevenue === 0) {
    return { change_ugx, change_pct: thisRevenue === 0 ? 0 : null };
  }
  return { change_ugx, change_pct: Math.round((change_ugx / lastRevenue) * 100) };
}

export function formatUgxWhole(amount: number): string {
  const n = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `UGX ${n.toLocaleString("en-UG")}`;
}

export function formatWeekComparisonDisplay(params: {
  thisWeek: AskWakaPeriod;
  lastWeek: AskWakaPeriod;
  thisRevenue: number;
  lastRevenue: number;
}): { this_week_line: string; last_week_line: string; change_line: string } {
  const { change_ugx, change_pct } = weekChange(params.thisRevenue, params.lastRevenue);
  const pct = change_pct == null ? "n/a" : `${change_pct}%`;
  return {
    this_week_line: `${params.thisWeek.label}:\n${formatUgxWhole(params.thisRevenue)}`,
    last_week_line: `${params.lastWeek.label}:\n${formatUgxWhole(params.lastRevenue)}`,
    change_line: `Change:\n${formatUgxWhole(change_ugx)} (${pct})`,
  };
}

export function zeroPeriodMessage(period: AskWakaPeriod, noun: string): string {
  const range = formatAskWakaRangeShort(period.start_day, period.end_day);
  return `No ${noun} were recorded for ${range}.`;
}
