import { AlertTriangle, Boxes, FolderOpen, Package } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";
import { EnterpriseKpiCard } from "../enterprise/EnterpriseKpiCard";

type Props = {
  lang: Language;
  totalProducts: number;
  lowStockCount: number;
  shelfCount: number;
  inventoryValueUgx: number;
  onLowStockTap?: () => void;
};

export function InventoryStatGrid({
  lang,
  totalProducts,
  lowStockCount,
  shelfCount,
  inventoryValueUgx,
  onLowStockTap,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
      <EnterpriseKpiCard
        icon={Package}
        label={t(lang, "stockStatTotalProducts")}
        value={String(totalProducts)}
        hint={t(lang, "stockStatProductsHint")}
      />
      <EnterpriseKpiCard
        icon={AlertTriangle}
        label={t(lang, "stockStatLow")}
        value={String(lowStockCount)}
        hint={t(lang, "stockStatLowHint")}
        tone={lowStockCount > 0 ? "danger" : "default"}
        onClick={onLowStockTap}
      />
      <EnterpriseKpiCard
        icon={FolderOpen}
        label={t(lang, "stockStatShelves")}
        value={String(shelfCount)}
        hint={t(lang, "stockStatShelvesHint")}
      />
      <EnterpriseKpiCard
        icon={Boxes}
        label={t(lang, "stockStatValueShort")}
        value={formatUgx(inventoryValueUgx)}
        hint={t(lang, "stockStatValueHint")}
      />
    </div>
  );
}
