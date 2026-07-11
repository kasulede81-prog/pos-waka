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
    <div className="-mx-0.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
      <div className="flex min-w-max gap-1.5 px-0.5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={clsx(
              "min-h-[40px] shrink-0 rounded-full px-3.5 py-1.5 text-xs font-black transition-all duration-150",
              active === tab.id
                ? "bg-waka-600 text-white shadow-sm"
                : "border border-border bg-card text-muted-foreground active:bg-muted",
            )}
          >
            {t(lang, tab.labelKey as "stockTabOverview")}
          </button>
        ))}
      </div>
    </div>
  );
}
