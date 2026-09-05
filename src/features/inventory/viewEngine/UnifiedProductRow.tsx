import { useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import clsx from "clsx";
import type { Language, Product, ShopPreferences } from "../../../types";
import { t } from "../../../lib/i18n";
import { formatProductPriceLabel } from "../../../store/usePosStore";
import { InventoryStockStatus, inventoryStockKind } from "../../../components/inventory/workspace/InventoryStockStatus";
import { normalizedCategoryKey, shelfIconFor } from "../../../lib/productCategories";
import { formatMedicineListPrimary, formatMedicineListSecondary } from "../../../lib/pharmacyMedicine";
import { isPharmacyMode } from "../../../lib/pharmacy";
import { usePharmacyTerms } from "../../../lib/pharmacyTerms";
import { WakaCheckbox } from "../../../components/enterprise/WakaCheckbox";
import { ExpiryStatusBadge } from "../../../components/pharmacy/ExpiryStatusBadge";
import { StockProductActionSheet } from "../../../components/stock/StockProductActionSheet";
import { StockProductCard } from "../../../components/stock/StockProductCard";
import { useInventorySelectionOptional } from "../selection/InventorySelectionProvider";
import type { InventoryRowAction, InventoryViewMode } from "./types";

const LONG_PRESS_MS = 480;

export type UnifiedProductRowProps = {
  lang: Language;
  product: Product;
  preferences: ShopPreferences;
  viewMode: InventoryViewMode;
  locked: boolean;
  canAdd: boolean;
  canEdit?: boolean;
  canRemove: boolean;
  canSell: boolean;
  canRestock: boolean;
  isOnlyProduct?: boolean;
  variant?: "default" | "lowStock";
  onAction: (action: InventoryRowAction) => void;
  onOpenDetail?: () => void;
};

function CompactProductRow({
  lang,
  product: p,
  preferences,
  locked,
  canAdd,
  canEdit,
  canRemove,
  canSell,
  canRestock,
  variant,
  onAction,
  onOpenDetail,
}: Omit<UnifiedProductRowProps, "viewMode" | "isOnlyProduct">) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const selection = useInventorySelectionOptional();
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const pt = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);
  const shelf = normalizedCategoryKey(p) ? p.category!.trim() : t(lang, "uncategorized");
  const shelfIcon = shelfIconFor(shelf);
  const kind = inventoryStockKind(p);
  const lowStockFocus = variant === "lowStock";
  const selected = selection?.isSelected(p.id) ?? false;

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const onPointerDown = () => {
    clearPress();
    pressTimer.current = setTimeout(() => {
      selection?.enter();
      selection?.setSelected(p.id, true);
    }, LONG_PRESS_MS);
  };

  return (
    <>
      <div
        className={clsx(
          "inventory-product-row",
          locked && "opacity-55",
          kind === "low" && !locked && lowStockFocus && "inventory-row--low",
          kind === "out" && !locked && "inventory-row--out",
          selected && "bg-indigo-50/40",
        )}
        onPointerDown={onPointerDown}
        onPointerUp={clearPress}
        onPointerLeave={clearPress}
        onPointerCancel={clearPress}
      >
        {selection?.selectionMode ? (
          <WakaCheckbox
            row={false}
            checked={selected}
            onCheckedChange={(checked) => selection.setSelected(p.id, checked)}
            aria-label={p.name}
          />
        ) : null}
        <button
          type="button"
          disabled={!onOpenDetail}
          onClick={() => onOpenDetail?.()}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left active:opacity-90"
        >
          <span className="inventory-ops-icon text-base leading-none">
            {shelfIcon ?? "📦"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="inventory-product-row__name line-clamp-1">
                {pharmacyMode ? formatMedicineListPrimary(p) : p.name}
              </p>
              {pharmacyMode ? <ExpiryStatusBadge lang={lang} product={p} compact /> : null}
            </div>
            <p className="inventory-product-row__meta truncate">{shelf}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <InventoryStockStatus product={p} />
            <span className="text-sm font-bold text-teal-700">{formatProductPriceLabel(p)}</span>
          </div>
        </button>
        {!locked && (canAdd || canEdit || canRestock || canRemove || canSell) ? (
          <button
            type="button"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-muted"
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">{t(lang, "stockMoreActions")}</span>
          </button>
        ) : null}
      </div>
      <StockProductActionSheet
        lang={lang}
        open={sheetOpen}
        productName={p.name}
        canAdd={canAdd}
        canEdit={canEdit}
        canRestock={canRestock}
        canRemove={canRemove}
        canSell={canSell}
        sellLabel={pharmacyMode ? pt("stockCardSell") : undefined}
        onClose={() => setSheetOpen(false)}
        onAction={(action) => onAction(action)}
      />
    </>
  );
}

export function UnifiedProductRow(props: UnifiedProductRowProps) {
  const { viewMode, ...rest } = props;

  if (viewMode === "compact") {
    return <CompactProductRow {...rest} />;
  }

  if (viewMode === "card") {
    return (
      <StockProductCard
        lang={rest.lang}
        product={rest.product}
        preferences={rest.preferences}
        locked={rest.locked}
        canAdd={rest.canAdd}
        canEdit={rest.canEdit}
        canRemove={rest.canRemove}
        canSell={rest.canSell}
        canRestock={rest.canRestock}
        isOnlyProduct={rest.isOnlyProduct}
        variant={rest.variant}
        onAction={rest.onAction}
        onOpenDetail={rest.onOpenDetail}
        density="comfortable"
      />
    );
  }

  return null;
}

export { formatMedicineListSecondary };
