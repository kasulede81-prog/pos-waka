import { useId, useState, type ReactNode } from "react";
import clsx from "clsx";
import { CalendarDays, ChevronDown } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DateFilterPreset, DateFilterValue } from "../../lib/dateFilters";
import { dateKeyKampala } from "../../lib/datesUg";
import { formatDateFilterViewingLabel } from "../../lib/dateFilterLabels";

const PRESETS: DateFilterPreset[] = ["today", "yesterday", "this_week", "this_month"];

export function formatHistoryPickerDate(dateKey: string, lang: Language): string {
  const parts = dateKey.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return dateKey;
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const locale = lang === "sw" ? "sw-UG" : "en-UG";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Kampala",
  }).format(anchor);
}

type Props = {
  lang: Language;
  filter: DateFilterValue;
  onFilterChange: (next: DateFilterValue) => void;
  /** Override label in the closed picker button. */
  labelOverride?: string;
  /** Extra controls below presets (e.g. custom date range). */
  footer?: ReactNode;
  /** Shorter closed picker button (sales history). */
  compact?: boolean;
};

export function HistoryDatePickerStrip({ lang, filter, onFilterChange, labelOverride, footer, compact = false }: Props) {
  const dateInputId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const customDayKey = filter.kind === "day" ? filter.dateKey : dateKeyKampala(new Date());
  const filterLabel = formatDateFilterViewingLabel(lang, filter);
  const pickerDateLabel =
    labelOverride ?? (filter.kind === "day" ? formatHistoryPickerDate(filter.dateKey, lang) : filterLabel);

  const presetLabel = (p: DateFilterPreset) => {
    if (p === "today") return t(lang, "dateFilterPresetToday");
    if (p === "yesterday") return t(lang, "dateFilterPresetYesterday");
    if (p === "this_week") return t(lang, "dateFilterPresetThisWeek");
    return t(lang, "dateFilterPresetThisMonth");
  };

  const rangeFrom =
    filter.kind === "range" ? filter.fromKey : filter.kind === "day" ? filter.dateKey : customDayKey;
  const rangeTo = filter.kind === "range" ? filter.toKey : rangeFrom;

  const panelPositionClass = compact
    ? "top-full mt-1"
    : "bottom-full mb-1";

  return (
    <div
      className={clsx(
        "relative border-t border-white/10 bg-waka-800/35",
        compact ? "px-2 py-1" : "px-3 py-2",
        pickerOpen && "z-50",
      )}
    >
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className={clsx(
          "mx-auto flex w-full max-w-sm items-center justify-center gap-1.5 rounded-xl px-2 font-bold text-white/95 active:bg-white/10",
          compact ? "min-h-[34px] text-xs" : "min-h-[40px] text-sm",
        )}
      >
        <CalendarDays className={clsx("shrink-0 opacity-90", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
        <span>{pickerDateLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${pickerOpen ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {pickerOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[44]"
            aria-label={t(lang, "cancel")}
            onClick={() => setPickerOpen(false)}
          />
          <div
            className={clsx(
              "absolute left-3 right-3 z-[45] rounded-2xl border border-border bg-card p-3 text-foreground shadow-xl",
              panelPositionClass,
            )}
          >
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    onFilterChange({ kind: "preset", preset });
                    setPickerOpen(false);
                  }}
                  className={`min-h-[36px] rounded-full border px-3 text-xs font-black ${
                    filter.kind === "preset" && filter.preset === preset
                      ? "border-waka-500 bg-waka-600 text-white"
                      : "border-border bg-muted text-foreground"
                  }`}
                >
                  {presetLabel(preset)}
                </button>
              ))}
            </div>
            <label
              htmlFor={dateInputId}
              className="mt-3 flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-muted px-3 text-sm font-bold text-foreground"
            >
              <CalendarDays className="h-4 w-4 shrink-0 text-waka-600" aria-hidden />
              <span>{t(lang, "dateFilterPickDate")}</span>
              <input
                id={dateInputId}
                type="date"
                className="ml-auto max-w-[9rem] rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold"
                value={customDayKey}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  onFilterChange({ kind: "day", dateKey: v });
                  setPickerOpen(false);
                }}
              />
            </label>
            <div className="mt-3 space-y-2 rounded-xl border border-border bg-muted p-3">
              <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                {t(lang, "dateFilterCustomRange")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  className="min-h-[36px] flex-1 rounded-lg border border-border bg-card px-2 text-xs font-semibold"
                  value={rangeFrom}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    onFilterChange({ kind: "range", fromKey: v, toKey: rangeTo >= v ? rangeTo : v });
                  }}
                />
                <span className="text-xs font-bold text-muted-foreground">→</span>
                <input
                  type="date"
                  className="min-h-[36px] flex-1 rounded-lg border border-border bg-card px-2 text-xs font-semibold"
                  value={rangeTo}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    onFilterChange({ kind: "range", fromKey: rangeFrom <= v ? rangeFrom : v, toKey: v });
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    onFilterChange({ kind: "range", fromKey: rangeFrom, toKey: rangeTo });
                    setPickerOpen(false);
                  }}
                  className="min-h-[36px] rounded-full border border-waka-500 bg-waka-600 px-3 text-xs font-black text-white"
                >
                  {t(lang, "dateFilterApplyRange")}
                </button>
              </div>
            </div>
            {footer ? <div className="mt-3 border-t border-border pt-3">{footer}</div> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
