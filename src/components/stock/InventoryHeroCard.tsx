import { AlertTriangle, Boxes, Package } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { HistoryHeroCard } from "../shared/HistoryHeroCard";

type Props = {
  lang: Language;
  totalProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
  inventoryValueUgx: number;
};

export function InventoryHeroCard({
  lang,
  totalProducts,
  lowStockCount,
  outOfStockCount,
  inventoryValueUgx,
}: Props) {
  return (
    <HistoryHeroCard
      lang={lang}
      metrics={[
        {
          label: t(lang, "stockStatTotalProducts"),
          icon: Package,
          value: String(totalProducts),
        },
        {
          label: t(lang, "stockStatLow"),
          icon: AlertTriangle,
          value: String(lowStockCount),
          hint:
            outOfStockCount > 0
              ? `${outOfStockCount} ${t(lang, "stockStatOut")}`
              : t(lang, "allStockOk"),
        },
        {
          label: t(lang, "stockStatValue"),
          icon: Boxes,
          value: tTemplate(lang, "stockStatValueAmount", { amount: inventoryValueUgx.toLocaleString() }),
        },
      ]}
    />
  );
}
