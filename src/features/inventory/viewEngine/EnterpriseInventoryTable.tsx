import { memo, useEffect, useRef, useState } from "react";
import { Barcode, MoreHorizontal, Pencil, ShoppingCart, Package } from "lucide-react";
import clsx from "clsx";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Language, Product, ShopPreferences } from "../../../types";
import { t } from "../../../lib/i18n";
import { formatProductPriceLabel } from "../../../store/usePosStore";
import { formatStockLabel, isLowStock } from "../../../lib/sellingEngine";
import { formatPharmacyStockPrimary, isPharmacyPackagingActive } from "../../../lib/pharmacyPackaging";
import { normalizedCategoryKey } from "../../../lib/productCategories";
import { formatMedicineListPrimary } from "../../../lib/pharmacyMedicine";
import { isPharmacyMode } from "../../../lib/pharmacy";
import { WakaCheckbox } from "../../../components/enterprise/WakaCheckbox";
import { StockProductActionSheet } from "../../../components/stock/StockProductActionSheet";
import { useInventorySelectionOptional } from "../selection/InventorySelectionProvider";
import { barcodeForProduct } from "../export/productLabelPrint";
import type { InventoryListSortKey, InventoryRowAction } from "./types";

const ROW_ESTIMATE = 44;
const BOTTOM_SCROLL_GUTTER = 24;

const GRID =
  "grid-cols-[40px_minmax(140px,2fr)_minmax(88px,1fr)_minmax(88px,1fr)_minmax(64px,0.6fr)_minmax(72px,0.7fr)_minmax(72px,0.7fr)_minmax(72px,0.7fr)_minmax(72px,0.7fr)_120px]";

type Props = {
  lang: Language;
  products: Product[];
  preferences: ShopPreferences;
  lockedIds: Set<string>;
  sort: InventoryListSortKey;
  onSort: (sort: InventoryListSortKey) => void;
  canAdd: boolean;
  canRemove: boolean;
  canSell: boolean;
  canRestock: boolean;
  onAction: (product: Product, action: InventoryRowAction) => void;
  onOpenDetail?: (product: Product) => void;
  onVisibleIdsChange?: (ids: string[]) => void;
};

function formatCost(p: Product): string {
  const c = p.costPricePerUnitUgx;
  if (c == null || !Number.isFinite(c)) return "—";
  return Math.round(c).toLocaleString();
}

function formatUpdated(p: Product): string {
  const d = new Date(p.updatedAt);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TableRowQuickActions({
  lang,
  product,
  locked,
  canSell,
  onAction,
  onOpenDetail,
}: {
  lang: Language;
  product: Product;
  locked: boolean;
  canSell: boolean;
  onAction: (action: InventoryRowAction) => void;
  onOpenDetail?: (product: Product) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  if (locked) return null;
  return (
    <div className="hidden items-center gap-0.5 group-hover:flex md:flex">
      <button type="button" title={t(lang, "stockActionEditDetails")} onClick={() => onAction("edit")} className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg hover:bg-muted">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button type="button" title={t(lang, "inventoryBulkStock")} onClick={() => onAction("restock")} className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg hover:bg-muted">
        <Package className="h-3.5 w-3.5" />
      </button>
      {canSell ? (
        <button type="button" title={t(lang, "stockActionOpenSell")} onClick={() => onAction("sell")} className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg hover:bg-muted">
          <ShoppingCart className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        title={t(lang, "inventoryPrintBarcode")}
        onClick={() => {
          if (typeof navigator !== "undefined" && navigator.clipboard) {
            void navigator.clipboard.writeText(barcodeForProduct(product));
          }
          onOpenDetail?.(product);
        }}
        className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg hover:bg-muted"
      >
        <Barcode className="h-3.5 w-3.5" />
      </button>
      <button type="button" title={t(lang, "stockMoreActions")} onClick={() => setMoreOpen(true)} className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg hover:bg-muted">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      <StockProductActionSheet
        lang={lang}
        open={moreOpen}
        productName={product.name}
        canAdd
        canRestock
        canRemove
        canSell={canSell}
        onClose={() => setMoreOpen(false)}
        onAction={(action) => onAction(action)}
      />
    </div>
  );
}

function EnterpriseInventoryTableInner({
  lang,
  products,
  preferences,
  lockedIds,
  sort,
  onSort,
  canSell,
  onAction,
  onOpenDetail,
  onVisibleIdsChange,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const selection = useInventorySelectionOptional();
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);

  const rowVirtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () =>
      parentRef.current?.closest<HTMLElement>(".scroll-main-chrome") ??
      document.querySelector<HTMLElement>(".scroll-main-chrome") ??
      parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    onVisibleIdsChange?.(virtualItems.map((v) => products[v.index]?.id).filter(Boolean) as string[]);
  }, [virtualItems, products, onVisibleIdsChange]);

  const headerBtn = (key: InventoryListSortKey, label: string) => (
    <button
      type="button"
      onClick={() => onSort(key)}
      className={clsx(
        "text-left text-[10px] font-black uppercase tracking-wide",
        sort === key ? "text-waka-700" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {sort === key ? " ▾" : ""}
    </button>
  );

  return (
    <div ref={parentRef} className="w-full overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <div className="min-w-[980px]">
        <div className={clsx("sticky top-0 z-10 grid gap-2 border-b border-border bg-muted/95 px-3 py-2 backdrop-blur", GRID)}>
          <div className="flex items-center justify-center">
            {selection?.selectionMode ? (
              <WakaCheckbox
                row={false}
                checked={products.length > 0 && products.every((p) => selection.isSelected(p.id))}
                onCheckedChange={(checked) => {
                  if (checked) selection.selectPage(products.map((p) => p.id));
                  else selection.clear();
                }}
                aria-label={t(lang, "inventorySelectPage")}
              />
            ) : null}
          </div>
          <div>{headerBtn("name_az", t(lang, "inventoryTableProduct"))}</div>
          <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "inventoryTableSku")}</div>
          <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "inventoryTableShelf")}</div>
          <div>{headerBtn("stock_low", t(lang, "inventoryTableStock"))}</div>
          <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "inventoryTableCost")}</div>
          <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "inventoryTablePrice")}</div>
          <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "inventoryTableStatus")}</div>
          <div>{headerBtn("updated", t(lang, "inventoryTableUpdated"))}</div>
          <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "inventoryTableActions")}</div>
        </div>
        <div style={{ height: `${rowVirtualizer.getTotalSize() + BOTTOM_SCROLL_GUTTER}px`, position: "relative" }}>
          {virtualItems.map((virtualRow) => {
            const p = products[virtualRow.index];
            if (!p) return null;
            const locked = lockedIds.has(p.id);
            const low = isLowStock(p);
            const shelf = normalizedCategoryKey(p) ? p.category!.trim() : t(lang, "uncategorized");
            const stockText = isPharmacyPackagingActive(p) ? formatPharmacyStockPrimary(p) : formatStockLabel(p);
            const selected = selection?.isSelected(p.id) ?? false;
            return (
              <div
                key={p.id}
                className={clsx(
                  "group absolute left-0 top-0 grid w-full gap-2 border-b border-border/60 px-3 py-2 text-xs",
                  GRID,
                  locked && "opacity-55",
                  low && !locked && "bg-rose-50/20",
                  selected && "bg-indigo-50/40",
                )}
                style={{ transform: `translateY(${virtualRow.start}px)`, height: `${virtualRow.size}px` }}
              >
                <div className="flex items-center justify-center">
                  {selection?.selectionMode ? (
                    <WakaCheckbox
                      row={false}
                      checked={selected}
                      onCheckedChange={(checked) => selection.setSelected(p.id, checked)}
                      aria-label={p.name}
                    />
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={!onOpenDetail}
                  onClick={() => onOpenDetail?.(p)}
                  className="truncate text-left font-bold text-foreground hover:text-waka-700"
                >
                  {pharmacyMode ? formatMedicineListPrimary(p) : p.name}
                </button>
                <span className="truncate font-semibold text-muted-foreground">{p.sku?.trim() || "—"}</span>
                <span className="truncate font-semibold text-muted-foreground">{shelf}</span>
                <span className={clsx("font-bold", low ? "text-rose-700" : "text-muted-foreground")}>{stockText}</span>
                <span className="font-semibold text-muted-foreground">{formatCost(p)}</span>
                <span className="font-black text-teal-700">{formatProductPriceLabel(p)}</span>
                <span className="font-semibold text-muted-foreground">
                  {locked ? t(lang, "productLockedBadge") : low ? t(lang, "cardLowStock") : "—"}
                </span>
                <span className="font-semibold text-muted-foreground">{formatUpdated(p)}</span>
                <TableRowQuickActions
                  lang={lang}
                  product={p}
                  locked={locked}
                  canSell={canSell}
                  onAction={(action) => onAction(p, action)}
                  onOpenDetail={onOpenDetail}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const EnterpriseInventoryTable = memo(EnterpriseInventoryTableInner);
