import { AlertTriangle, Boxes, FolderOpen, Package } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";
import { Caption, MonoNumber } from "../enterprise/EnterpriseTypography";

type Props = {
  lang: Language;
  totalProducts: number;
  lowStockCount: number;
  shelfCount: number;
  inventoryValueUgx: number;
  showInventoryValue?: boolean;
  onLowStockTap?: () => void;
};

export function InventoryStatGrid({
  lang,
  totalProducts,
  lowStockCount,
  shelfCount,
  inventoryValueUgx,
  showInventoryValue = true,
  onLowStockTap,
}: Props) {
  const low = lowStockCount > 0;
  return (
    <div className="inventory-products-summary" aria-label={t(lang, "stockStatTotalProducts")}>
      <div className="inventory-products-summary__item">
        <Package className="h-4 w-4 text-muted-foreground" aria-hidden />
        <Caption className="inventory-products-summary__label">{t(lang, "stockStatTotalProducts")}</Caption>
        <MonoNumber className="inventory-products-summary__value">{totalProducts}</MonoNumber>
      </div>
      <button
        type="button"
        className={low ? "inventory-products-summary__item is-low" : "inventory-products-summary__item"}
        onClick={onLowStockTap}
      >
        <AlertTriangle className="h-4 w-4" aria-hidden />
        <Caption className="inventory-products-summary__label">{t(lang, "stockStatLow")}</Caption>
        <MonoNumber className="inventory-products-summary__value">{lowStockCount}</MonoNumber>
      </button>
      <div className="inventory-products-summary__item">
        <FolderOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
        <Caption className="inventory-products-summary__label">{t(lang, "stockStatShelves")}</Caption>
        <MonoNumber className="inventory-products-summary__value">{shelfCount}</MonoNumber>
      </div>
      <div className="inventory-products-summary__item">
        <Boxes className="h-4 w-4 text-muted-foreground" aria-hidden />
        <Caption className="inventory-products-summary__label">{t(lang, "stockStatValueShort")}</Caption>
        <MonoNumber className="inventory-products-summary__value">
          {showInventoryValue ? formatUgx(inventoryValueUgx) : "—"}
        </MonoNumber>
      </div>
    </div>
  );
}
