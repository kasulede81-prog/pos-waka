import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

export type StockHubTab = "overview" | "products" | "shelves" | "low" | "movements";

const TABS: { id: StockHubTab; labelKey: string }[] = [
  { id: "overview", labelKey: "stockTabOverview" },
  { id: "products", labelKey: "stockTabProducts" },
  { id: "shelves", labelKey: "stockTabShelves" },
  { id: "low", labelKey: "stockTabLow" },
  { id: "movements", labelKey: "stockTabMovements" },
];

type Props = {
  lang: Language;
  active: StockHubTab;
  onChange: (tab: StockHubTab) => void;
};

export function StockSectionTabs({ lang, active, onChange }: Props) {
  return (
    <div className="-mx-1 overflow-x-auto pb-1">
      <div className="flex min-w-max gap-2 px-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={clsx(
              "min-h-[44px] shrink-0 rounded-2xl px-4 py-2 text-sm font-black transition",
              active === tab.id ? "bg-slate-900 text-white shadow-sm" : "border-2 border-slate-200 bg-white text-slate-700",
            )}
          >
            {t(lang, tab.labelKey as "stockTabOverview")}
          </button>
        ))}
      </div>
    </div>
  );
}
