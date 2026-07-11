import { useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import clsx from "clsx";
import type { Language, Product, ShopPreferences } from "../../../types";
import { t } from "../../../lib/i18n";
import { formatProductPriceLabel } from "../../../store/usePosStore";
import { formatStockLabel, isLowStock } from "../../../lib/sellingEngine";
import { formatPharmacyStockPrimary, isPharmacyPackagingActive } from "../../../lib/pharmacyPackaging";
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
  const low = isLowStock(p);
  const shelf = normalizedCategoryKey(p) ? p.category!.trim() : t(lang, "uncategorized");
  const shelfIcon = shelfIconFor(shelf);
  const stockText = isPharmacyPackagingActive(p) ? formatPharmacyStockPrimary(p) : formatStockLabel(p);
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
          "flex min-h-[68px] items-center gap-2 rounded-lg border bg-card px-2 py-1.5 shadow-sm",
          locked ? "border-border/80 opacity-55" : "border-border/90",
          low && !locked && lowStockFocus && "border-rose-200/90 bg-rose-50/30",
          selected && "border-indigo-300 bg-indigo-50/40",
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
          className="flex min-w-0 flex-1 items-center gap-2 text-left active:opacity-90"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-base leading-none">
            {shelfIcon ?? "📦"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="line-clamp-1 text-sm font-black text-foreground">
                {pharmacyMode ? formatMedicineListPrimary(p) : p.name}
              </p>
              {pharmacyMode ? <ExpiryStatusBadge lang={lang} product={p} compact /> : null}
            </div>
            <p className="truncate text-[10px] font-semibold text-muted-foreground">{shelf}</p>
            <div className="flex items-baseline gap-2">
              <span className={clsx("text-[10px] font-bold", low && !locked ? "text-rose-700" : "text-muted-foreground")}>
                {stockText}
              </span>
              <span className="text-xs font-black text-teal-700">{formatProductPriceLabel(p)}</span>
            </div>
          </div>
        </button>
        {!locked && (canAdd || canRestock || canRemove || canSell) ? (
          <button
            type="button"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground active:bg-muted"
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
