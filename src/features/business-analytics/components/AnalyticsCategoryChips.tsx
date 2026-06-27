import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { categoryLabelKey } from "../lib/analyticsPageView";
import type { AnalyticsCategory } from "../types";
import { ANALYTICS_CATEGORIES } from "../types";

type Props = {
  lang: Language;
  active: AnalyticsCategory;
  canProfit: boolean;
  onChange: (category: AnalyticsCategory) => void;
};

export function AnalyticsCategoryChips({ lang, active, canProfit, onChange }: Props) {
  const categories = ANALYTICS_CATEGORIES.filter((c) => c !== "profit" || canProfit);

  return (
    <div className="-mx-0.5 flex gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
      {categories.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={clsx(
            "min-h-[36px] shrink-0 rounded-full px-3.5 py-1.5 text-xs font-black transition-all",
            active === id
              ? "bg-waka-600 text-white shadow-sm"
              : "border border-stone-200 bg-white text-stone-700 active:bg-stone-50",
          )}
        >
          {t(lang, categoryLabelKey(id))}
        </button>
      ))}
    </div>
  );
}
