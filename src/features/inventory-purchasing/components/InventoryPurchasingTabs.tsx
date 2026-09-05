import clsx from "clsx";
import { CreditCard, LayoutDashboard, Package, Receipt, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

const TAB_ICONS: Record<InventoryPurchasingTab, LucideIcon> = {
  overview: LayoutDashboard,
  purchases: Receipt,
  suppliers: Truck,
  products: Package,
  payments: CreditCard,
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
    <div className="inventory-hub-tabs -mx-0.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
      <div className="flex min-w-max gap-1.5 px-0.5">
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab];
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onChange(tab)}
              className={clsx(
                "inventory-hub-tab min-h-10 shrink-0 rounded-full px-3.5 py-1.5 text-sm font-bold transition-waka",
                active === tab ? "inventory-hub-tab--active" : "inventory-hub-tab--idle",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t(lang, TAB_LABELS[tab] as "ipTabOverview")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
