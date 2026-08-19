import clsx from "clsx";
import type { Product } from "../../../types";
import { PosDesktopProductCard } from "../PosDesktopProductCard";

type Props = {
  products: Product[];
  gridTemplateColumns: string;
  justifyContent?: string;
  sparse?: boolean;
  columns?: number;
  stockLabel: string;
  sellLabel: string;
  lockedBadge: string;
  lockedIds: Set<string>;
  favoriteIds?: Set<string>;
  cartQtyByProductId: Map<string, number>;
  onPick: (product: Product) => void;
  onToggleFavorite?: (productId: string) => void;
  className?: string;
};

/** Touch-friendly product grid — typography only, no product images. */
export function DesktopProductGrid({
  products,
  gridTemplateColumns,
  justifyContent,
  sparse,
  columns,
  stockLabel,
  sellLabel,
  lockedBadge,
  lockedIds,
  favoriteIds,
  cartQtyByProductId,
  onPick,
  onToggleFavorite,
  className,
}: Props) {
  return (
    <div
      className={clsx("desktop-pos-product-grid grid gap-1.5", className)}
      style={{ gridTemplateColumns, justifyContent }}
      data-pos-sparse-cols={columns}
      data-pos-sparse={sparse ? "1" : undefined}
    >
      {products.map((p) => (
        <PosDesktopProductCard
          key={p.id}
          product={p}
          stockLabel={stockLabel}
          sellLabel={sellLabel}
          locked={lockedIds.has(p.id)}
          lockedBadge={lockedBadge}
          favorite={favoriteIds?.has(p.id)}
          cartQty={cartQtyByProductId.get(p.id) ?? 0}
          onPick={onPick}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  );
}
