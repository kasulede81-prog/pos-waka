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
