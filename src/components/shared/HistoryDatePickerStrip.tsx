import { useId, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DateFilterPreset, DateFilterValue } from "../../lib/dateFilters";
import { dateKeyKampala } from "../../lib/datesUg";
import { formatDateFilterViewingLabel } from "../../lib/dateFilterLabels";

const PRESETS: DateFilterPreset[] = ["today", "this_week", "this_month"];

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
};

export function HistoryDatePickerStrip({ lang, filter, onFilterChange, labelOverride, footer }: Props) {
  const dateInputId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const customDayKey = filter.kind === "day" ? filter.dateKey : dateKeyKampala(new Date());
  const filterLabel = formatDateFilterViewingLabel(lang, filter);
  const pickerDateLabel =
    labelOverride ?? (filter.kind === "day" ? formatHistoryPickerDate(filter.dateKey, lang) : filterLabel);

  const presetLabel = (p: DateFilterPreset) => {
    if (p === "today") return t(lang, "dateFilterPresetToday");
    if (p === "this_week") return t(lang, "dateFilterPresetThisWeek");
    return t(lang, "dateFilterPresetThisMonth");
  };

  return (
    <div className="relative border-t border-white/10 bg-waka-800/35 px-3 py-2">
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="mx-auto flex min-h-[40px] w-full max-w-sm items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-white/95 active:bg-white/10"
      >
        <CalendarDays className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
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
          <div className="absolute bottom-full left-3 right-3 z-[45] mb-1 rounded-2xl border border-stone-200 bg-white p-3 text-stone-900 shadow-xl">
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
                      : "border-stone-200 bg-stone-50 text-stone-800"
                  }`}
                >
                  {presetLabel(preset)}
                </button>
              ))}
            </div>
            <label
              htmlFor={dateInputId}
              className="mt-3 flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm font-bold text-stone-800"
            >
              <CalendarDays className="h-4 w-4 shrink-0 text-waka-600" aria-hidden />
              <span>{t(lang, "dateFilterPickDate")}</span>
              <input
                id={dateInputId}
                type="date"
                className="ml-auto max-w-[9rem] rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-semibold"
                value={customDayKey}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  onFilterChange({ kind: "day", dateKey: v });
                  setPickerOpen(false);
                }}
              />
            </label>
            {footer ? <div className="mt-3 border-t border-stone-100 pt-3">{footer}</div> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
