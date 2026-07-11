import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DebtsQuickFilter } from "../../lib/debtsPageView";

const FILTERS: DebtsQuickFilter[] = ["all", "outstanding", "overdue", "paid_today", "this_week"];

type Props = {
  lang: Language;
  active: DebtsQuickFilter;
  onChange: (filter: DebtsQuickFilter) => void;
};

function labelFor(lang: Language, filter: DebtsQuickFilter): string {
  if (filter === "all") return t(lang, "debtsFilterAll");
  if (filter === "outstanding") return t(lang, "debtsFilterOutstanding");
  if (filter === "overdue") return t(lang, "debtsFilterOverdue");
  if (filter === "paid_today") return t(lang, "debtsFilterPaidToday");
  return t(lang, "debtsFilterThisWeek");
}

export function DebtsFilterChips({ lang, active, onChange }: Props) {
  return (
    <div className="-mx-0.5 flex gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
      {FILTERS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={clsx(
            "min-h-[34px] shrink-0 rounded-full px-3 py-1 text-xs font-black transition-all",
            active === id
              ? "bg-waka-600 text-white shadow-sm"
              : "border border-border bg-card text-muted-foreground active:bg-muted",
          )}
        >
          {labelFor(lang, id)}
        </button>
      ))}
    </div>
  );
}
