import type { Sale } from "../types";

const KAMPALA_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Kampala",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Hot-path cache — sales often share identical ISO timestamps. */
const ISO_DATE_KEY_CACHE = new Map<string, string>();
const ISO_DATE_KEY_CACHE_MAX = 60_000;

function formatKampalaDateKey(d: Date): string {
  return KAMPALA_DATE_FMT.format(d);
}

/** YYYY-MM-DD in Kampala for grouping “today” sales offline */
export function dateKeyKampala(isoOrDate: string | Date): string {
  if (typeof isoOrDate === "string") {
    const cached = ISO_DATE_KEY_CACHE.get(isoOrDate);
    if (cached !== undefined) return cached;
    const key = formatKampalaDateKey(new Date(isoOrDate));
    if (ISO_DATE_KEY_CACHE.size >= ISO_DATE_KEY_CACHE_MAX) ISO_DATE_KEY_CACHE.clear();
    ISO_DATE_KEY_CACHE.set(isoOrDate, key);
    return key;
  }
  return formatKampalaDateKey(isoOrDate);
}

/** Test-only — reset memoization between benchmark runs. */
export function clearDateKeyKampalaCacheForTests(): void {
  ISO_DATE_KEY_CACHE.clear();
}

/** Calendar-day key at least `days` days before today (device local + Kampala formatting). */
export function dateKeyDaysAgoKampala(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return dateKeyKampala(d);
}

export type { ReceiptDateRange } from "./dateFilters";

/** YYYY-MM in Kampala timezone. */
export function monthKeyKampala(isoOrDate: string | Date): string {
  return dateKeyKampala(isoOrDate).slice(0, 7);
}

/** Previous calendar month key (YYYY-MM), independent of device timezone. */
export function previousMonthKey(monthKey: string): string {
  const parts = monthKey.split("-").map(Number);
  const year = parts[0] ?? 2020;
  const month = parts[1] ?? 1;
  if (month <= 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** Recent Kampala month keys, newest first. */
export function monthKeyOptionsKampala(count = 18, now: Date = new Date()): string[] {
  const out: string[] = [];
  const today = dateKeyKampala(now);
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let i = 0; i < count; i++) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

const KAMPALA_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Kampala",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const REPORT_TIMEZONE = "Africa/Kampala";

/** Date, time, and timezone for report headers — always Kampala, never device local. */
export function formatDateTimeKampala(isoOrDate: string | Date = new Date()): {
  dateKey: string;
  time: string;
  timeZone: typeof REPORT_TIMEZONE;
  display: string;
} {
  const dateKey = dateKeyKampala(isoOrDate);
  const time = KAMPALA_TIME_FMT.format(typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate);
  return {
    dateKey,
    time,
    timeZone: REPORT_TIMEZONE,
    display: `${dateKey} ${time} ${REPORT_TIMEZONE}`,
  };
}

/** Monday-start week key (YYYY-MM-DD of Monday) in Kampala. */
export function weekStartKeyKampala(isoOrDate: string | Date): string {
  const key = dateKeyKampala(isoOrDate);
  const parts = key.split("-").map(Number);
  const y = parts[0] ?? 2020;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const mon0 = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - mon0);
  return dateKeyKampala(anchor);
}

/**
 * Canonical reporting day for a sale — matches server RPC (created_at) and all local dashboards.
 */
export function saleReportingDayKey(sale: Pick<Sale, "createdAt">): string {
  return dateKeyKampala(sale.createdAt);
}

export { saleMatchesReceiptRange } from "./dateFilters";
