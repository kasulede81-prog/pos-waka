import type { Language } from "../types";
import { t } from "./i18n";
import type { DateFilterValue } from "./dateFilters";
import { resolveDateFilterBounds } from "./dateFilters";
import { monthKeyKampala } from "./datesUg";

function kampalaLocale(lang: Language): string {
  return lang === "sw" ? "sw-UG" : "en-UG";
}

/** Long month name from YYYY-MM (Kampala calendar). */
export function formatMonthLabelKampala(monthKey: string, lang: Language): string {
  const parts = monthKey.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  if (!y || !m) return monthKey;
  const anchor = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
  return new Intl.DateTimeFormat(kampalaLocale(lang), {
    month: "long",
    timeZone: "Africa/Kampala",
  }).format(anchor);
}

/** e.g. "June 2026" for reports headings. */
export function formatMonthYearLabelKampala(monthKey: string, lang: Language): string {
  const parts = monthKey.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  if (!y || !m) return monthKey;
  const anchor = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
  return new Intl.DateTimeFormat(kampalaLocale(lang), {
    month: "long",
    year: "numeric",
    timeZone: "Africa/Kampala",
  }).format(anchor);
}

function formatKampalaDayHeading(dateKey: string, lang: Language): string {
  const parts = dateKey.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return dateKey;
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const locale = lang === "sw" ? "sw-UG" : "en-UG";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Kampala",
  }).format(anchor);
}

export function formatDateFilterViewingLabel(lang: Language, value: DateFilterValue): string {
  if (value.kind === "day") {
    return formatKampalaDayHeading(value.dateKey, lang);
  }
  if (value.kind === "range") {
    if (value.fromKey === value.toKey) return formatKampalaDayHeading(value.fromKey, lang);
    return `${formatKampalaDayHeading(value.fromKey, lang)} – ${formatKampalaDayHeading(value.toKey, lang)}`;
  }
  if (value.preset === "today") return t(lang, "dateFilterPresetToday");
  if (value.preset === "yesterday") return t(lang, "dateFilterPresetYesterday");
  if (value.preset === "this_week") return t(lang, "dateFilterPresetThisWeek");
  if (value.preset === "this_month") {
    return formatMonthYearLabelKampala(monthKeyKampala(new Date()), lang);
  }
  return t(lang, "dateFilterPresetThisMonth");
}

export function formatDateFilterChipDay(dateKey: string, lang: Language): string {
  return formatKampalaDayHeading(dateKey, lang);
}

export function isSingleDayFilter(value: DateFilterValue, now: Date = new Date()): boolean {
  return resolveDateFilterBounds(value, now).isSingleDay;
}

export function selectedDayKeyForFilter(value: DateFilterValue, now: Date = new Date()): string | null {
  const bounds = resolveDateFilterBounds(value, now);
  return bounds.isSingleDay ? bounds.fromKey : null;
}
