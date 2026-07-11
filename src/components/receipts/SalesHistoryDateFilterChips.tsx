import { useId, useState } from "react";
import clsx from "clsx";
import { CalendarDays } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DateFilterPreset, DateFilterValue } from "../../lib/dateFilters";
import { dateKeyKampala } from "../../lib/datesUg";

type ChipId = DateFilterPreset | "custom" | "all_time";

const PRESET_CHIPS: { id: ChipId; preset?: DateFilterPreset }[] = [
  { id: "today", preset: "today" },
  { id: "yesterday", preset: "yesterday" },
  { id: "this_week", preset: "this_week" },
  { id: "this_month", preset: "this_month" },
  { id: "custom" },
  { id: "all_time" },
];

type Props = {
  lang: Language;
  filter: DateFilterValue;
  onFilterChange: (next: DateFilterValue) => void;
};

function isAllTimeFilter(filter: DateFilterValue): boolean {
  if (filter.kind !== "range") return false;
  return filter.fromKey <= "2020-01-01";
}

function chipActive(filter: DateFilterValue, chipId: ChipId): boolean {
  if (chipId === "all_time") return isAllTimeFilter(filter);
  if (chipId === "custom") return filter.kind === "day" || (filter.kind === "range" && !isAllTimeFilter(filter));
  return filter.kind === "preset" && filter.preset === chipId;
}

export function SalesHistoryDateFilterChips({ lang, filter, onFilterChange }: Props) {
  const dateInputId = useId();
  const [customOpen, setCustomOpen] = useState(false);
  const today = dateKeyKampala(new Date());
  const customDayKey = filter.kind === "day" ? filter.dateKey : today;

  const labelFor = (chipId: ChipId) => {
    if (chipId === "today") return t(lang, "dateFilterPresetToday");
    if (chipId === "yesterday") return t(lang, "dateFilterPresetYesterday");
    if (chipId === "this_week") return t(lang, "dateFilterPresetThisWeek");
    if (chipId === "this_month") return t(lang, "dateFilterPresetThisMonth");
    if (chipId === "custom") return t(lang, "salesHistoryFilterCustom");
    return t(lang, "salesHistoryFilterAllTime");
  };

  const onChipClick = (chipId: ChipId) => {
    if (chipId === "custom") {
      setCustomOpen((v) => !v);
      return;
    }
    setCustomOpen(false);
    if (chipId === "all_time") {
      onFilterChange({ kind: "range", fromKey: "2020-01-01", toKey: today });
      return;
    }
    if (chipId === "today" || chipId === "yesterday" || chipId === "this_week" || chipId === "this_month") {
      onFilterChange({ kind: "preset", preset: chipId });
    }
  };

  return (
    <div className="space-y-2">
      <div className="-mx-0.5 flex gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
        {PRESET_CHIPS.map(({ id }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChipClick(id)}
            className={clsx(
              "min-h-[34px] shrink-0 rounded-full px-3 py-1 text-xs font-black transition-all",
              chipActive(filter, id)
                ? "bg-waka-600 text-white shadow-sm"
                : "border border-border bg-card text-muted-foreground active:bg-muted",
            )}
          >
            {labelFor(id)}
          </button>
        ))}
      </div>
      {customOpen ? (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <label htmlFor={dateInputId} className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <CalendarDays className="h-4 w-4 text-waka-600" aria-hidden />
            {t(lang, "dateFilterPickDate")}
            <input
              id={dateInputId}
              type="date"
              className="ml-auto rounded-lg border border-border px-2 py-1 text-xs font-semibold"
              value={customDayKey}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                onFilterChange({ kind: "day", dateKey: v });
                setCustomOpen(false);
              }}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
