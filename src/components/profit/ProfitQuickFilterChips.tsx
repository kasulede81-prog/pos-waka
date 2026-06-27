import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { ProfitQuickFilter } from "../../lib/profitPageView";

const FILTERS: ProfitQuickFilter[] = ["all", "highest_profit", "lowest_profit", "loss_making", "shelves", "products"];

type Props = {
  lang: Language;
  active: ProfitQuickFilter;
  onChange: (filter: ProfitQuickFilter) => void;
};

function labelFor(lang: Language, filter: ProfitQuickFilter): string {
  if (filter === "all") return t(lang, "profitFilterAll");
  if (filter === "highest_profit") return t(lang, "profitFilterHighest");
  if (filter === "lowest_profit") return t(lang, "profitFilterLowest");
  if (filter === "loss_making") return t(lang, "profitFilterLoss");
  if (filter === "shelves") return t(lang, "profitFilterShelves");
  return t(lang, "profitFilterProducts");
}

export function ProfitQuickFilterChips({ lang, active, onChange }: Props) {
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
              : "border border-stone-200 bg-white text-stone-700 active:bg-stone-50",
          )}
        >
          {labelFor(lang, id)}
        </button>
      ))}
    </div>
  );
}
