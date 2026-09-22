import clsx from "clsx";
import { Package, Star } from "lucide-react";
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
 * Phase 32.4.3 — dense desktop sell tile, whole-card selection (no floating +).
 * Favorite remains a separate control so it does not steal the sell action.
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
        "pos-ds-product-card relative flex min-h-[132px] flex-col overflow-hidden rounded-lg border bg-card text-left shadow-sm",
        POS_CATALOG_TILE_TOUCH_CLASS,
        locked ? "border-border/80 opacity-55" : "border-border/90",
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
          className="absolute right-1 top-1 z-10 flex h-8 w-8 min-h-[32px] min-w-[32px] items-center justify-center rounded-full border border-border/80 bg-card/95 text-sm shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-500 active:bg-muted"
          aria-label={favorite ? "Remove favorite" : "Add favorite"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(product.id);
          }}
        >
          <Star className="size-4" fill={favorite ? "currentColor" : "none"} aria-hidden />
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => onPick(product)}
        disabled={locked}
        aria-label={`${sellLabel}: ${product.name}`}
        className={clsx(
          "pos-sell-direct-card flex min-h-0 flex-1 cursor-pointer flex-col justify-between p-3 text-left",
          "transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out motion-reduce:transition-none",
          locked
            ? "cursor-not-allowed"
            : [
                 "hover:border-primary/50 hover:bg-accent",
                 "active:scale-[0.985] active:bg-muted",
                 "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                "motion-reduce:active:scale-100",
              ],
        )}
      >
        <p
          className={clsx(
            "pos-ds-product-name line-clamp-3 text-[13px] font-black leading-snug text-foreground",
            onToggleFavorite || cartQty > 0 || locked ? "pr-8" : undefined,
          )}
        >
          {product.name}
        </p>
        <p className="pos-ds-product-price mt-2 text-sm font-black tabular-nums text-primary">
          {formatProductPriceLabel(product)}
        </p>
        <span
          className={clsx(
            "pos-ds-product-stock mt-2 inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-1 text-[10px] font-bold",
            lowStock ? "bg-danger-muted text-danger" : "bg-success-muted text-success",
          )}
        >
          <Package className="size-3 shrink-0" aria-hidden />
          {product.baseUnit} · {stockLabel}: {formatStockLabel(product)}
        </span>
      </button>
    </article>
  );
}
