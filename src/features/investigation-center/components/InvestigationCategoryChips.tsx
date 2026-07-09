import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { categoryLabelKey } from "../lib/activityPresentation";
import type { InvestigationCategory } from "../types";

type Props = {
  lang: Language;
  active: InvestigationCategory;
  onChange: (category: InvestigationCategory) => void;
  categories: InvestigationCategory[];
  accentCategories?: ReadonlySet<InvestigationCategory>;
};

export function InvestigationCategoryChips({
  lang,
  active,
  onChange,
  categories,
  accentCategories,
}: Props) {
  return (
    <div className="space-y-2">
      <div className="-mx-0.5 flex gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
        {categories.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={clsx(
              "min-h-[34px] shrink-0 rounded-full px-3 py-1 text-xs font-black transition-all",
              active === id
                ? "bg-waka-600 text-white shadow-sm"
                : "border border-stone-200 bg-white text-stone-700 active:bg-stone-50",
              accentCategories?.has(id)
                ? active === id
                  ? "bg-violet-700 ring-violet-200"
                  : "border-violet-200/80 text-violet-900"
                : null,
            )}
          >
            {t(lang, categoryLabelKey(id))}
          </button>
        ))}
      </div>
    </div>
  );
}
