import type { Language } from "../../types";

/**
 * Shared customer-surface date formatting (Phase A, extracted in Phase B so the
 * member dashboard and the wallet button render dates identically).
 *
 * Dates follow the selected language. Luganda has no dedicated Intl locale, so
 * Uganda English formatting stands in for it; Swahili gets real Swahili month
 * names. Date semantics (which instant, what is shown) are unchanged.
 */
export const DATE_LOCALES: Record<Language, string> = { en: "en-GB", lg: "en-UG", sw: "sw-KE" };

/** A date the member can act on, or null when the value is absent or unparseable. */
export function formatDay(iso: string | null | undefined, lang: Language): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(DATE_LOCALES[lang], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Full date+time for the enrollment submission stamp. */
export function formatDateTime(iso: string | null | undefined, lang: Language): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(DATE_LOCALES[lang]);
}

/** Phase C — the Activity Center's date presets. "all" disables both bounds. */
export type ActivityRange = "all" | "today" | "week" | "month" | "custom";

/**
 * Phase C — local-day bounds for an activity range, as ISO instants for the
 * server's `p_from`/`p_to` (timestamptz) parameters.
 *
 * - today:  [start of local today, start of tomorrow)
 * - week:   a rolling 7-day window ending tomorrow (today + the previous 6 days)
 * - month:  [start of this local month, start of next month)
 * - custom: the chosen date(s), each inclusive local day; missing side = open
 * - all:    no bounds (the pre-Phase-C behavior)
 *
 * Semantics are half-open intervals on local midnights, so "Today" cannot leak
 * yesterday's rows regardless of the database server's timezone.
 */
export function activityRangeBounds(
  range: ActivityRange,
  customFrom?: string,
  customTo?: string,
): { from?: string; to?: string } {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const parseDay = (value: string | undefined): Date | null => {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const nextDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

  const now = new Date();
  switch (range) {
    case "today": {
      const from = startOfDay(now);
      return { from: from.toISOString(), to: nextDay(from).toISOString() };
    }
    case "week": {
      const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
      return { from: from.toISOString(), to: nextDay(now).toISOString() };
    }
    case "month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    case "custom": {
      let from = parseDay(customFrom);
      let to = parseDay(customTo);
      if (from && to && from.getTime() > to.getTime()) {
        [from, to] = [to, from]; // tolerate a reversed range instead of returning nothing
      }
      return {
        from: from ? from.toISOString() : undefined,
        to: to ? nextDay(to).toISOString() : undefined,
      };
    }
    default:
      return {};
  }
}
