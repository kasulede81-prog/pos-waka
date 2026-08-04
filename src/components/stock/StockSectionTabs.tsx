import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

export type StockHubTab = "overview" | "products" | "shelves" | "low" | "movements";

const ALL_TABS: { id: StockHubTab; labelKey: string }[] = [
  { id: "overview", labelKey: "stockTabOverview" },
  { id: "products", labelKey: "stockTabProducts" },
  { id: "shelves", labelKey: "stockTabShelves" },
  { id: "low", labelKey: "stockTabLow" },
  { id: "movements", labelKey: "stockTabMovements" },
];

/** When embedded in InventoryPurchasingPage, overview lives on the hub — omit duplicate. */
const EMBEDDED_TABS = ALL_TABS.filter((tab) => tab.id !== "overview");

type Props = {
  lang: Language;
  active: StockHubTab;
  onChange: (tab: StockHubTab) => void;
  /** Phase 31.1 — single hub IA: hide nested overview when products are embedded */
  embedded?: boolean;
};

export function StockSectionTabs({ lang, active, onChange, embedded }: Props) {
  const tabs = embedded ? EMBEDDED_TABS : ALL_TABS;
  return (
    <div className="-mx-0.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]" role="tablist" aria-label={t(lang, "stockTabProducts")}>
      <div className="flex min-w-max gap-1.5 px-0.5">
        {tabs.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.id)}
              className={clsx(
                "min-h-[40px] shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-waka",
                selected
                  ? "bg-primary text-primary-foreground shadow-elev"
                  : "border border-border bg-card text-muted-foreground hover:bg-muted active:bg-muted",
              )}
            >
              {t(lang, tab.labelKey as "stockTabOverview")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
