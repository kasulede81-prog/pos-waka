import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { INVENTORY_PURCHASING_TABS, type InventoryPurchasingTab } from "../types";

const TAB_LABELS: Record<InventoryPurchasingTab, string> = {
  overview: "ipTabOverview",
  purchases: "ipTabPurchases",
  suppliers: "ipTabSuppliers",
  products: "ipTabProducts",
  payments: "ipTabPayments",
};

type Props = {
  lang: Language;
  active: InventoryPurchasingTab;
  onChange: (tab: InventoryPurchasingTab) => void;
  visibleTabs?: InventoryPurchasingTab[];
};

export function InventoryPurchasingTabs({ lang, active, onChange, visibleTabs }: Props) {
  const tabs = visibleTabs ?? INVENTORY_PURCHASING_TABS;

  return (
    <div className="-mx-0.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
      <div className="flex min-w-max gap-1.5 px-0.5">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onChange(tab)}
            className={clsx(
              "min-h-[40px] shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-waka",
              active === tab
                ? "bg-primary text-primary-foreground shadow-elev"
                : "border border-border bg-card text-muted-foreground hover:bg-muted active:bg-muted",
            )}
          >
            {t(lang, TAB_LABELS[tab] as "ipTabOverview")}
          </button>
        ))}
      </div>
    </div>
  );
}
