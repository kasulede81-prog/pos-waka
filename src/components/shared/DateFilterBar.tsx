import { useId } from "react";
import { CalendarDays } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DateFilterPreset, DateFilterValue } from "../../lib/dateFilters";
import { dateKeyKampala } from "../../lib/datesUg";
import { formatDateFilterChipDay } from "../../lib/dateFilterLabels";

const PRESETS: DateFilterPreset[] = ["today", "this_week", "this_month"];

type Props = {
  lang: Language;
  value: DateFilterValue;
  onChange: (next: DateFilterValue) => void;
  showCustomDate?: boolean;
  /** Accent for selected preset — matches page theme. */
  activeClassName?: string;
  inactiveClassName?: string;
};

export function DateFilterBar({
  lang,
  value,
  onChange,
  showCustomDate = true,
  activeClassName = "border-waka-400 bg-waka-600 text-white shadow-sm",
  inactiveClassName = "border-stone-200 bg-white text-stone-700 hover:border-waka-200 hover:bg-waka-50",
}: Props) {
  const dateInputId = useId();
  const presetActive = value.kind === "preset" ? value.preset : null;
  const customDayKey = value.kind === "day" ? value.dateKey : dateKeyKampala(new Date());

  const presetLabel = (p: DateFilterPreset) => {
    if (p === "today") return t(lang, "dateFilterPresetToday");
    if (p === "this_week") return t(lang, "dateFilterPresetThisWeek");
    return t(lang, "dateFilterPresetThisMonth");
  };

  const activateDayMode = () => {
    if (value.kind !== "day") {
      onChange({ kind: "day", dateKey: dateKeyKampala(new Date()) });
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onChange({ kind: "preset", preset })}
          className={`min-h-[40px] shrink-0 rounded-full border px-3.5 text-xs font-black transition-colors active:scale-[0.98] sm:text-sm ${
            presetActive === preset ? activeClassName : inactiveClassName
          }`}
        >
          {presetLabel(preset)}
        </button>
      ))}
      {showCustomDate ? (
        <label
          htmlFor={dateInputId}
          className={`relative inline-flex min-h-[40px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-xs font-black transition-colors active:scale-[0.98] sm:text-sm ${
            value.kind === "day" ? activeClassName : inactiveClassName
          }`}
        >
          <CalendarDays className="pointer-events-none h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="pointer-events-none">
            {value.kind === "day" ? formatDateFilterChipDay(value.dateKey, lang) : t(lang, "dateFilterPickDate")}
          </span>
          <input
            id={dateInputId}
            type="date"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            value={customDayKey}
            onFocus={activateDayMode}
            onClick={activateDayMode}
            onChange={(e) => {
              const v = e.target.value;
              if (v) onChange({ kind: "day", dateKey: v });
            }}
            aria-label={t(lang, "dateFilterPickDate")}
          />
        </label>
      ) : null}
    </div>
  );
}
