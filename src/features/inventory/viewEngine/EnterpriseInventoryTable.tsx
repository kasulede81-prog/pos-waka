import { memo, useMemo, useState } from "react";
import { Barcode, MoreHorizontal, Pencil, ShoppingCart, Package } from "lucide-react";
import clsx from "clsx";
import type { Language, Product, ShopPreferences } from "../../../types";
import { t } from "../../../lib/i18n";
import { formatProductPriceLabel } from "../../../store/usePosStore";
import { isLowStock } from "../../../lib/sellingEngine";
import { normalizedCategoryKey } from "../../../lib/productCategories";
import { formatMedicineListPrimary } from "../../../lib/pharmacyMedicine";
import { isPharmacyMode } from "../../../lib/pharmacy";
import { resolveStockProductSheetActionIds, StockProductActionSheet } from "../../../components/stock/StockProductActionSheet";
import { InventoryStockStatus, inventoryStockKind } from "../../../components/inventory/workspace/InventoryStockStatus";
import {
  EnterpriseDataTable,
  type EnterpriseDataColumn,
  type EnterpriseDataSelectionApi,
} from "../../../components/enterprise/data-table";
import { useInventorySelectionOptional } from "../selection/InventorySelectionProvider";
import { barcodeForProduct } from "../export/productLabelPrint";
import type { InventoryListSortKey, InventoryRowAction } from "./types";

type Props = {
  lang: Language;
  products: Product[];
  preferences: ShopPreferences;
  lockedIds: Set<string>;
  sort: InventoryListSortKey;
  onSort: (sort: InventoryListSortKey) => void;
  canAdd: boolean;
  canEdit?: boolean;
  canRemove: boolean;
  canSell: boolean;
  canRestock: boolean;
  canSeeCost?: boolean;
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
  canAdd,
  canEdit,
  canRestock,
  canRemove,
  canSell,
  onAction,
  onOpenDetail,
}: {
  lang: Language;
  product: Product;
  locked: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canRestock: boolean;
  canRemove: boolean;
  canSell: boolean;
  onAction: (action: InventoryRowAction) => void;
  onOpenDetail?: (product: Product) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  if (locked) return null;
  const hasSheetActions = resolveStockProductSheetActionIds({
    canAdd,
    canEdit,
    canRestock,
    canRemove,
    canSell,
  }).length > 0;
  return (
    <div className="hidden items-center gap-0.5 group-hover:flex md:flex">
      {canEdit ? (
        <button type="button" title={t(lang, "stockActionEditDetails")} onClick={() => onAction("edit")} className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg hover:bg-muted">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {canRestock ? (
        <button type="button" title={t(lang, "inventoryBulkStock")} onClick={() => onAction("restock")} className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg hover:bg-muted">
          <Package className="h-3.5 w-3.5" />
        </button>
      ) : null}
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
      {hasSheetActions ? (
        <button type="button" title={t(lang, "stockMoreActions")} onClick={() => setMoreOpen(true)} className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg hover:bg-muted">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <StockProductActionSheet
        lang={lang}
        open={moreOpen}
        productName={product.name}
        canAdd={canAdd}
        canEdit={canEdit}
        canRestock={canRestock}
        canRemove={canRemove}
        canSell={canSell}
        onClose={() => setMoreOpen(false)}
        onAction={(action) => onAction(action)}
      />
    </div>
  );
}

/** Inventory desktop table — consumer of shared EnterpriseDataTable (Phase 30.1). */
function EnterpriseInventoryTableInner({
  lang,
  products,
  preferences,
  lockedIds,
  sort,
  onSort,
  canAdd,
  canEdit,
  canRemove,
  canSell,
  canRestock,
  canSeeCost = true,
  onAction,
  onOpenDetail,
  onVisibleIdsChange,
}: Props) {
  const invSelection = useInventorySelectionOptional();
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);

  const selection: EnterpriseDataSelectionApi | undefined = useMemo(() => {
    if (!invSelection?.selectionMode) return undefined;
    return {
      enabled: true,
      selectedIds: new Set(products.filter((p) => invSelection.isSelected(p.id)).map((p) => p.id)),
      isSelected: invSelection.isSelected,
      setSelected: invSelection.setSelected,
      selectIds: (ids) => invSelection.selectPage(ids),
      clear: invSelection.clear,
      toggleAll: (ids, selected) => {
        if (selected) invSelection.selectPage(ids);
        else invSelection.clear();
      },
    };
  }, [invSelection, products]);

  const columns: EnterpriseDataColumn<Product>[] = useMemo(
    () => [
      {
        id: "name_az",
        header: t(lang, "inventoryTableProduct"),
        width: "minmax(140px,2fr)",
        sortable: true,
        cell: (p) => (
          <span className="inventory-table-product">
            {pharmacyMode ? formatMedicineListPrimary(p) : p.name}
          </span>
        ),
        className: "text-foreground",
      },
      {
        id: "sku",
        header: t(lang, "inventoryTableSku"),
        width: "minmax(88px,1fr)",
        hideBelow: "lg",
        cell: (p) => p.sku?.trim() || "—",
      },
      {
        id: "shelf",
        header: t(lang, "inventoryTableShelf"),
        width: "minmax(88px,1fr)",
        hideBelow: "lg",
        cell: (p) => (normalizedCategoryKey(p) ? p.category!.trim() : t(lang, "uncategorized")),
      },
      {
        id: "stock_low",
        header: t(lang, "inventoryTableStock"),
        width: "minmax(64px,0.6fr)",
        sortable: true,
        cell: (p) => <InventoryStockStatus product={p} />,
      },
      ...(canSeeCost
        ? [
            {
              id: "cost",
              header: t(lang, "inventoryTableCost"),
              width: "minmax(72px,0.7fr)",
              hideBelow: "xl" as const,
              cell: (p: Product) => formatCost(p),
            },
          ]
        : []),
      {
        id: "price",
        header: t(lang, "inventoryTablePrice"),
        width: "minmax(72px,0.7fr)",
        cell: (p) => <span className="font-bold text-teal-700">{formatProductPriceLabel(p)}</span>,
      },
      {
        id: "status",
        header: t(lang, "inventoryTableStatus"),
        width: "minmax(72px,0.7fr)",
        cell: (p) => {
          if (lockedIds.has(p.id)) return t(lang, "productLockedBadge");
          const kind = inventoryStockKind(p);
          if (kind === "out") return t(lang, "iwStatOutOfStock");
          if (kind === "low") return t(lang, "cardLowStock");
          return "—";
        },
      },
      {
        id: "updated",
        header: t(lang, "inventoryTableUpdated"),
        width: "minmax(72px,0.7fr)",
        sortable: true,
        hideBelow: "xl",
        cell: (p) => formatUpdated(p),
      },
    ],
    [lang, pharmacyMode, lockedIds, canSeeCost],
  );

  return (
    <EnterpriseDataTable
      rows={products}
      columns={columns}
      rowKey={(p) => p.id}
      sortKey={sort}
      onSort={(colId) => {
        if (colId === "name_az" || colId === "stock_low" || colId === "updated") {
          onSort(colId);
        }
      }}
      selection={selection}
      onRowActivate={onOpenDetail}
      onVisibleIdsChange={onVisibleIdsChange}
      minWidthPx={980}
      ariaLabel={t(lang, "inventoryTableProduct")}
      getRowClassName={(p) =>
        clsx(
          lockedIds.has(p.id) && "opacity-55",
          !lockedIds.has(p.id) && p.stockOnHand <= 0 && "inventory-row--out",
          !lockedIds.has(p.id) && isLowStock(p) && p.stockOnHand > 0 && "inventory-row--low",
        )
      }
      rowActions={(p) => (
        <TableRowQuickActions
          lang={lang}
          product={p}
          locked={lockedIds.has(p.id)}
          canAdd={canAdd}
          canEdit={canEdit ?? canAdd}
          canRestock={canRestock}
          canRemove={canRemove}
          canSell={canSell}
          onAction={(action) => onAction(p, action)}
          onOpenDetail={onOpenDetail}
        />
      )}
    />
  );
}

export const EnterpriseInventoryTable = memo(EnterpriseInventoryTableInner);
