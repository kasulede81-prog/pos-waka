import { memo, useEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Language, Product, ShopPreferences } from "../../../types";
import { useInventoryViewOptional } from "./InventoryViewContext";
import { EnterpriseInventoryTable } from "./EnterpriseInventoryTable";
import { INVENTORY_VIEW_ROW_ESTIMATE, type InventoryListSortKey, type InventoryRowAction } from "./types";
import { UnifiedProductRow } from "./UnifiedProductRow";

const BOTTOM_SCROLL_GUTTER = 24;

type Props = {
  lang: Language;
  products: Product[];
  preferences: ShopPreferences;
  lockedIds: Set<string>;
  canAdd: boolean;
  canRemove: boolean;
  canSell: boolean;
  canRestock: boolean;
  isOnlyProduct: boolean;
  variant?: "default" | "lowStock";
  listSort: InventoryListSortKey;
  onListSort: (sort: InventoryListSortKey) => void;
  onAction: (product: Product, action: InventoryRowAction) => void;
  onOpenDetail?: (product: Product) => void;
  onVisibleIdsChange?: (ids: string[]) => void;
};

function InventoryProductListInner({
  lang,
  products,
  preferences,
  lockedIds,
  canAdd,
  canRemove,
  canSell,
  canRestock,
  isOnlyProduct,
  variant = "default",
  listSort,
  onListSort,
  onAction,
  onOpenDetail,
  onVisibleIdsChange,
}: Props) {
  const view = useInventoryViewOptional();
  const mode = view?.mode ?? "card";
  const rowEstimate = view?.rowEstimatePx ?? INVENTORY_VIEW_ROW_ESTIMATE[mode];
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () =>
      parentRef.current?.closest<HTMLElement>(".scroll-main-chrome") ??
      document.querySelector<HTMLElement>(".scroll-main-chrome") ??
      parentRef.current,
    estimateSize: () => rowEstimate,
    overscan: 6,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    if (mode === "table") return;
    onVisibleIdsChange?.(virtualItems.map((v) => products[v.index]?.id).filter(Boolean) as string[]);
  }, [virtualItems, products, mode, onVisibleIdsChange]);

  if (mode === "table") {
    return (
      <EnterpriseInventoryTable
        lang={lang}
        products={products}
        preferences={preferences}
        lockedIds={lockedIds}
        sort={listSort}
        onSort={onListSort}
        canAdd={canAdd}
        canRemove={canRemove}
        canSell={canSell}
        canRestock={canRestock}
        onAction={onAction}
        onOpenDetail={onOpenDetail}
        onVisibleIdsChange={onVisibleIdsChange}
      />
    );
  }

  return (
    <div ref={parentRef} className="w-full">
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize() + BOTTOM_SCROLL_GUTTER}px` }}
      >
        {virtualItems.map((virtualRow) => {
          const p = products[virtualRow.index];
          if (!p) return null;
          return (
            <div
              key={p.id}
              className="absolute left-0 top-0 w-full px-0.5 pb-1.5"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                height: `${virtualRow.size}px`,
              }}
            >
              <UnifiedProductRow
                lang={lang}
                product={p}
                preferences={preferences}
                viewMode={mode}
                locked={lockedIds.has(p.id)}
                canAdd={canAdd}
                canRemove={canRemove}
                canSell={canSell}
                canRestock={canRestock}
                isOnlyProduct={isOnlyProduct}
                variant={variant}
                onAction={(action) => onAction(p, action)}
                onOpenDetail={onOpenDetail ? () => onOpenDetail(p) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const InventoryProductList = memo(InventoryProductListInner);

export function InventoryProductListEmpty({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
