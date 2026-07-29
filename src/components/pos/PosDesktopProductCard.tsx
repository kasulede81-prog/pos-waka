import clsx from "clsx";
import { Plus } from "lucide-react";
import type { Product } from "../../types";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { formatStockLabel } from "../../lib/sellingEngine";
import { POS_CATALOG_TILE_TOUCH_CLASS } from "../../lib/posTouchInteraction";

type Props = {
  product: Product;
  stockLabel: string;
  sellLabel: string;
  locked?: boolean;
  lockedBadge?: string;
  favorite?: boolean;
  cartQty?: number;
  onPick: (product: Product) => void;
  onToggleFavorite?: (productId: string) => void;
};

/**
 * Phase 28.1 — dense desktop sell tile, name-first (no image / letter avatar).
 * Whole card taps to add (or open sheet when product needs configuration).
 */
export function PosDesktopProductCard({
  product,
  stockLabel,
  sellLabel,
  locked,
  lockedBadge,
  favorite,
  cartQty = 0,
  onPick,
  onToggleFavorite,
}: Props) {
  const lowStock = product.stockOnHand <= product.minimumStockAlert;

  return (
    <article
      className={clsx(
        "pos-ds-product-card relative flex min-h-[112px] flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm",
        POS_CATALOG_TILE_TOUCH_CLASS,
        locked ? "border-border/80 opacity-55" : "border-border/90 active:border-teal-400",
      )}
      style={{ contentVisibility: "auto" }}
    >
      {locked && lockedBadge ? (
        <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-foreground/90 px-1.5 py-0.5 text-[8px] font-black uppercase text-background">
          {lockedBadge}
        </span>
      ) : cartQty > 0 ? (
        <span className="absolute left-1.5 top-1.5 z-10 flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-teal-700 px-1.5 text-[11px] font-black text-white shadow-sm">
          {Number.isInteger(cartQty) ? cartQty : cartQty.toFixed(1)}
        </span>
      ) : null}

      {onToggleFavorite ? (
        <button
          type="button"
          className="absolute right-1 top-1 z-10 flex h-8 w-8 min-h-[32px] min-w-[32px] items-center justify-center rounded-full border border-border/80 bg-card/95 text-sm shadow-sm active:bg-muted"
          aria-label={favorite ? "Remove favorite" : "Add favorite"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(product.id);
          }}
        >
          {favorite ? "★" : "☆"}
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => onPick(product)}
        disabled={locked}
        aria-label={`${sellLabel}: ${product.name}`}
        className="flex min-h-0 flex-1 flex-col p-2 text-left"
      >
        <p
          className={clsx(
            "pos-ds-product-name line-clamp-3 text-[13px] font-black leading-snug text-foreground",
            onToggleFavorite || cartQty > 0 || locked ? "pr-8" : undefined,
          )}
        >
          {product.name}
        </p>
        <p className="pos-ds-product-price mt-1 text-xs font-black tabular-nums text-waka-800">
          {formatProductPriceLabel(product)}
        </p>
        <p
          className={clsx(
            "pos-ds-product-stock mt-0.5 truncate text-[10px] font-bold",
            lowStock ? "text-rose-700" : "text-emerald-800",
          )}
        >
          {stockLabel}: {formatStockLabel(product)}
        </p>
        <span
          className={clsx(
            "pos-ds-product-cta mt-auto flex h-9 w-9 min-h-[36px] min-w-[36px] items-center justify-center self-end rounded-lg",
            locked ? "bg-muted text-muted-foreground" : "bg-waka-600 text-white",
          )}
          aria-hidden
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
        </span>
      </button>
    </article>
  );
}
