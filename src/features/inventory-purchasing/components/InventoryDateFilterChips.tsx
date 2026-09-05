import { useId, useState } from "react";
import clsx from "clsx";
import { CalendarDays } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { DateFilterPreset, DateFilterValue } from "../../../lib/dateFilters";
import { dateKeyKampala } from "../../../lib/datesUg";

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

/** Inventory-owned date presentation. Same DateFilterValue contract as Sales History chips. */
export function InventoryDateFilterChips({ lang, filter, onFilterChange }: Props) {
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
    <div className="inventory-date-filter">
      <div className="inventory-date-filter__chips" role="group" aria-label={t(lang, "dateFilterPickDate")}>
        {PRESET_CHIPS.map(({ id }) => {
          const active = chipActive(filter, id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => onChipClick(id)}
              className={clsx("inventory-date-chip", active ? "inventory-date-chip--on" : "inventory-date-chip--off")}
            >
              {id === "custom" ? <CalendarDays className="h-3.5 w-3.5" aria-hidden /> : null}
              {labelFor(id)}
            </button>
          );
        })}
      </div>
      {customOpen ? (
        <label htmlFor={dateInputId} className="inventory-date-filter__custom">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
          <span>{t(lang, "dateFilterPickDate")}</span>
          <input
            id={dateInputId}
            type="date"
            className="inventory-date-filter__input"
            value={customDayKey}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              onFilterChange({ kind: "day", dateKey: v });
              setCustomOpen(false);
            }}
          />
        </label>
      ) : null}
    </div>
  );
}
