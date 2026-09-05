import clsx from "clsx";
import { AlertTriangle, FolderOpen, History, Package } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

export type StockHubTab = "overview" | "products" | "shelves" | "low" | "movements";

const ALL_TABS: { id: StockHubTab; labelKey: string; Icon: LucideIcon }[] = [
  { id: "overview", labelKey: "stockTabOverview", Icon: Package },
  { id: "products", labelKey: "stockTabProducts", Icon: Package },
  { id: "shelves", labelKey: "stockTabShelves", Icon: FolderOpen },
  { id: "low", labelKey: "stockTabLow", Icon: AlertTriangle },
  { id: "movements", labelKey: "stockTabMovements", Icon: History },
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
    <div className="inventory-sub-tabs -mx-0.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]" role="tablist" aria-label={t(lang, "stockTabProducts")}>
      <div className="flex min-w-max gap-2 px-0.5">
        {tabs.map((tab) => {
          const selected = active === tab.id;
          const Icon = tab.Icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.id)}
              className={clsx(
                "inventory-sub-tab shrink-0 px-2.5 py-1.5 transition-waka",
                selected ? "inventory-sub-tab--active" : "inventory-sub-tab--idle",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t(lang, tab.labelKey as "stockTabOverview")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
