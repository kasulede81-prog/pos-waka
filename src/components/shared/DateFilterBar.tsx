import { useId, useRef } from "react";
import { CalendarDays } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DateFilterPreset, DateFilterValue } from "../../lib/dateFilters";
import { dateKeyKampala } from "../../lib/datesUg";

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
  const dateInputRef = useRef<HTMLInputElement>(null);
  const customDayKey = value.kind === "day" ? value.dateKey : null;
  const presetActive = value.kind === "preset" ? value.preset : null;

  const presetLabel = (p: DateFilterPreset) => {
    if (p === "today") return t(lang, "dateFilterPresetToday");
    if (p === "this_week") return t(lang, "dateFilterPresetThisWeek");
    return t(lang, "dateFilterPresetThisMonth");
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
        <>
          <input
            ref={dateInputRef}
            id={dateInputId}
            type="date"
            className="sr-only"
            value={customDayKey ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v) onChange({ kind: "day", dateKey: v });
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (customDayKey) {
                dateInputRef.current?.showPicker?.();
                dateInputRef.current?.click();
                return;
              }
              onChange({ kind: "day", dateKey: dateKeyKampala(new Date()) });
              requestAnimationFrame(() => {
                dateInputRef.current?.showPicker?.();
                dateInputRef.current?.click();
              });
            }}
            className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-black transition-colors active:scale-[0.98] sm:text-sm ${
              value.kind === "day" ? activeClassName : inactiveClassName
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t(lang, "dateFilterPickDate")}
          </button>
        </>
      ) : null}
    </div>
  );
}
