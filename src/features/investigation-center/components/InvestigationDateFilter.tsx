import { useId, useState } from "react";
import clsx from "clsx";
import { CalendarDays } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { DateFilterPreset, DateFilterValue } from "../../../lib/dateFilters";
import { resolveDateFilterBounds } from "../../../lib/dateFilters";
import { formatDateFilterViewingLabel } from "../../../lib/dateFilterLabels";
import { dateKeyKampala } from "../../../lib/datesUg";

type ChipId = DateFilterPreset | "custom";

const PRESET_CHIPS: { id: ChipId; preset?: DateFilterPreset }[] = [
  { id: "today", preset: "today" },
  { id: "this_week", preset: "this_week" },
  { id: "this_month", preset: "this_month" },
  { id: "custom" },
];

type Props = {
  lang: Language;
  filter: DateFilterValue;
  onFilterChange: (next: DateFilterValue) => void;
};

function isCustomFilter(filter: DateFilterValue): boolean {
  return filter.kind === "day" || filter.kind === "range";
}

function chipActive(filter: DateFilterValue, chipId: ChipId): boolean {
  if (chipId === "custom") return isCustomFilter(filter);
  return filter.kind === "preset" && filter.preset === chipId;
}

export function InvestigationDateFilter({ lang, filter, onFilterChange }: Props) {
  const fromInputId = useId();
  const toInputId = useId();
  const [customOpen, setCustomOpen] = useState(isCustomFilter(filter));
  const today = dateKeyKampala(new Date());
  const bounds = resolveDateFilterBounds(filter);
  const customFrom = filter.kind === "range" ? filter.fromKey : filter.kind === "day" ? filter.dateKey : bounds.fromKey;
  const customTo = filter.kind === "range" ? filter.toKey : filter.kind === "day" ? filter.dateKey : bounds.toKey;
  const periodLabel = formatDateFilterViewingLabel(lang, filter);

  const labelFor = (chipId: ChipId) => {
    if (chipId === "today") return t(lang, "dateFilterPresetToday");
    if (chipId === "this_week") return t(lang, "dateFilterPresetThisWeek");
    if (chipId === "this_month") return t(lang, "dateFilterPresetThisMonth");
    return t(lang, "salesHistoryFilterCustom");
  };

  const onChipClick = (chipId: ChipId) => {
    if (chipId === "custom") {
      setCustomOpen(true);
      if (!isCustomFilter(filter)) {
        onFilterChange({ kind: "range", fromKey: bounds.fromKey, toKey: bounds.toKey });
      }
      return;
    }
    setCustomOpen(false);
    onFilterChange({ kind: "preset", preset: chipId });
  };

  const applyCustomRange = (fromKey: string, toKey: string) => {
    if (!fromKey || !toKey) return;
    const from = fromKey <= toKey ? fromKey : toKey;
    const to = fromKey <= toKey ? toKey : fromKey;
    if (from === to) {
      onFilterChange({ kind: "day", dateKey: from });
      return;
    }
    onFilterChange({ kind: "range", fromKey: from, toKey: to });
  };

  return (
    <section className="rounded-2xl border border-border/90 bg-card p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 shrink-0 text-waka-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{t(lang, "icDateRange")}</p>
          <p className="truncate text-sm font-black text-foreground">{periodLabel}</p>
        </div>
      </div>

      <div className="mt-3 -mx-0.5 flex gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
        {PRESET_CHIPS.map(({ id }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChipClick(id)}
            className={clsx(
              "min-h-[36px] shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition-all",
              chipActive(filter, id)
                ? "bg-waka-600 text-white shadow-sm"
                : "border border-border bg-muted text-muted-foreground active:bg-muted",
            )}
          >
            {labelFor(id)}
          </button>
        ))}
      </div>

      {customOpen || isCustomFilter(filter) ? (
        <div className="mt-3 grid gap-3 rounded-xl border border-border bg-muted/80 p-3 sm:grid-cols-2">
          <label htmlFor={fromInputId} className="block text-xs font-bold text-muted-foreground">
            {t(lang, "auditFilterDateFrom")}
            <input
              id={fromInputId}
              type="date"
              max={today}
              className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold outline-none focus:border-waka-500"
              value={customFrom}
              onChange={(e) => applyCustomRange(e.target.value, customTo)}
            />
          </label>
          <label htmlFor={toInputId} className="block text-xs font-bold text-muted-foreground">
            {t(lang, "auditFilterDateTo")}
            <input
              id={toInputId}
              type="date"
              max={today}
              className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold outline-none focus:border-waka-500"
              value={customTo}
              onChange={(e) => applyCustomRange(customFrom, e.target.value)}
            />
          </label>
        </div>
      ) : null}
    </section>
  );
}
