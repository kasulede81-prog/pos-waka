import clsx from "clsx";
import type { Product } from "../../types";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { formatStockLabel } from "../../lib/sellingEngine";
import { POS_CATALOG_TILE_TOUCH_CLASS } from "../../lib/posTouchInteraction";

type Props = {
  product: Product;
  stockLabel: string;
  addLabel: string;
  locked?: boolean;
  lockedBadge?: string;
  /** Units already in the draft cart (badge). */
  cartQty?: number;
  onPick: (product: Product) => void;
};

/**
 * Phase 32.4.3 — cashier-first sell tile.
 * Whole card is the action target (no floating +). Hierarchy: Name → Price → Stock.
 */
export function PosSellProductCard({
  product,
  stockLabel,
  addLabel,
  locked,
  lockedBadge,
  cartQty = 0,
  onPick,
}: Props) {
  const lowStock = product.stockOnHand <= product.minimumStockAlert;

  return (
    <button
      type="button"
      onClick={() => onPick(product)}
      disabled={locked}
      aria-label={`${addLabel}: ${product.name}`}
      className={clsx(
        "pos-ds-product-card pos-sell-direct-card relative flex min-h-[96px] w-full cursor-pointer flex-col rounded-xl border p-2.5 text-left shadow-sm",
        "transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out motion-reduce:transition-none",
        POS_CATALOG_TILE_TOUCH_CLASS,
        locked
          ? "cursor-not-allowed border-border/80 bg-muted/90 opacity-55"
          : [
              "border-border/90 bg-card",
              "hover:border-teal-300/80 hover:shadow-md",
              "active:scale-[0.985] active:border-teal-500 active:bg-teal-50/90 active:shadow-sm",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500",
              "motion-reduce:active:scale-100",
            ],
      )}
    >
      {locked && lockedBadge ? (
        <span className="absolute right-1.5 top-1.5 z-[1] rounded-full bg-foreground/90 px-1.5 py-0.5 text-[8px] font-black uppercase text-background">
          {lockedBadge}
        </span>
      ) : cartQty > 0 ? (
        <span className="absolute right-1.5 top-1.5 z-[1] flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-teal-700 px-1.5 text-[11px] font-black text-white shadow-sm">
          {Number.isInteger(cartQty) ? cartQty : cartQty.toFixed(1)}
        </span>
      ) : null}

      <div className={clsx("flex min-h-0 min-w-0 flex-1 flex-col justify-center", cartQty > 0 || locked ? "pr-7" : undefined)}>
        <p className="pos-ds-product-name line-clamp-3 text-sm font-black leading-snug text-foreground">
          {product.name}
        </p>
        <p className="pos-ds-product-price mt-1.5 text-xs font-black tabular-nums text-teal-800">
          {formatProductPriceLabel(product)}
        </p>
        <span
          className={clsx(
            "pos-ds-product-stock mt-1.5 inline-block max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-bold",
            lowStock ? "bg-danger-muted text-danger" : "bg-success-muted text-success",
          )}
        >
          {stockLabel}: {formatStockLabel(product)}
        </span>
      </div>
    </button>
  );
}
