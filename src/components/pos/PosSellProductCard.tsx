import clsx from "clsx";
import { Plus } from "lucide-react";
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
 * Phase 28.1 — name-first sell tile (text only).
 * Hierarchy: Name → Price → Stock → compact add affordance.
 * Whole card is tappable; + is a secondary visual cue (min 44px hit).
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
        "pos-ds-product-card relative flex min-h-[112px] w-full flex-col rounded-xl border p-2.5 text-left shadow-sm transition-all motion-reduce:transition-none",
        POS_CATALOG_TILE_TOUCH_CLASS,
        locked
          ? "border-border/80 bg-muted/90 opacity-55"
          : "border-border/90 bg-card active:scale-[0.98] active:border-teal-400 active:shadow-md motion-reduce:active:scale-100",
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

      <div className={clsx("min-w-0 flex-1", cartQty > 0 || locked ? "pr-7" : "pr-1")}>
        <p className="pos-ds-product-name line-clamp-3 text-sm font-black leading-snug text-foreground">
          {product.name}
        </p>
        <p className="pos-ds-product-price mt-1 text-xs font-black tabular-nums text-teal-800">
          {formatProductPriceLabel(product)}
        </p>
        <span
          className={clsx(
            "pos-ds-product-stock mt-1 inline-block max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-bold",
            lowStock ? "bg-danger-muted text-danger" : "bg-success-muted text-success",
          )}
        >
          {stockLabel}: {formatStockLabel(product)}
        </span>
      </div>

      <span
        className={clsx(
          "pos-ds-product-cta mt-2 flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center self-end rounded-lg",
          locked ? "border border-border bg-muted text-muted-foreground" : "bg-teal-700 text-white",
        )}
        aria-hidden
      >
        <Plus className="h-5 w-5" strokeWidth={2.5} />
      </span>
    </button>
  );
}
