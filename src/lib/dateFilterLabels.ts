import type { Language } from "../types";
import { t } from "./i18n";
import type { DateFilterValue } from "./dateFilters";
import { resolveDateFilterBounds } from "./dateFilters";

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
  if (value.preset === "today") return t(lang, "dateFilterPresetToday");
  if (value.preset === "this_week") return t(lang, "dateFilterPresetThisWeek");
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
