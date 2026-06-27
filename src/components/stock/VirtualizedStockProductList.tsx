import { memo, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Language, Product, ShopPreferences } from "../../types";
import { StockProductCard } from "./StockProductCard";

const ROW_ESTIMATE = 118;
const BOTTOM_SCROLL_GUTTER = 24;

type RowAction = "edit" | "sell" | "restock" | "duplicate" | "remove";

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
  onAction: (product: Product, action: RowAction) => void;
  onOpenDetail?: (product: Product) => void;
  variant?: "default" | "lowStock";
};

function VirtualizedStockProductListInner({
  lang,
  products,
  preferences,
  lockedIds,
  canAdd,
  canRemove,
  canSell,
  canRestock,
  isOnlyProduct,
  onAction,
  onOpenDetail,
  variant = "default",
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () =>
      parentRef.current?.closest<HTMLElement>(".scroll-main-chrome") ??
      document.querySelector<HTMLElement>(".scroll-main-chrome") ??
      parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 6,
  });

  return (
    <div ref={parentRef} className="w-full">
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize() + BOTTOM_SCROLL_GUTTER}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const p = products[virtualRow.index];
          if (!p) return null;
          return (
            <div
              key={p.id}
              className="absolute left-0 top-0 w-full px-0.5 pb-2"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                height: `${virtualRow.size}px`,
              }}
            >
              <StockProductCard
                lang={lang}
                product={p}
                preferences={preferences}
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

export const VirtualizedStockProductList = memo(VirtualizedStockProductListInner);

export function StockProductListEmpty({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
