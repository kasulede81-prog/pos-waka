import clsx from "clsx";
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
  onPick: (product: Product) => void;
  onToggleFavorite?: (productId: string) => void;
};

/** Dense desktop sell tile — image placeholder, name, price, stock, sell CTA. */
export function PosDesktopProductCard({
  product,
  stockLabel,
  sellLabel,
  locked,
  lockedBadge,
  favorite,
  onPick,
  onToggleFavorite,
}: Props) {
  const lowStock = product.stockOnHand <= product.minimumStockAlert;
  const initial = (product.name.trim()[0] ?? "?").toUpperCase();

  return (
    <article
      className={clsx(
        "pos-ds-product-card relative flex min-h-[108px] flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm",
        POS_CATALOG_TILE_TOUCH_CLASS,
        locked ? "border-border/80 opacity-55" : "border-border/90 active:border-waka-400",
      )}
      style={{ contentVisibility: "auto" }}
    >
      {locked && lockedBadge ? (
        <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-foreground/90 px-1.5 py-0.5 text-[8px] font-black uppercase text-background">
          {lockedBadge}
        </span>
      ) : null}

      {onToggleFavorite ? (
        <button
          type="button"
          className="absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border/80 bg-card/95 text-sm shadow-sm active:bg-muted"
          aria-label={favorite ? "Remove favorite" : "Add favorite"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(product.id);
          }}
        >
          {favorite ? "★" : "☆"}
        </button>
      ) : null}

      <button type="button" onClick={() => onPick(product)} disabled={locked} className="flex min-h-0 flex-1 flex-col p-1.5 text-left">
        <div className="pos-ds-product-avatar relative flex h-10 items-center justify-center rounded-lg bg-gradient-to-br from-stone-100 to-muted">
          <span className="sr-only">{product.name}</span>
          <span className="text-lg font-black text-waka-600/80" aria-hidden>
            {initial}
          </span>
        </div>
        <p className="pos-ds-product-name mt-1 line-clamp-2 text-[11px] font-black leading-tight text-foreground">{product.name}</p>
        <p className="pos-ds-product-price mt-0.5 text-xs font-black text-waka-700">{formatProductPriceLabel(product)}</p>
        <p
          className={clsx(
            "pos-ds-product-stock mt-0.5 truncate text-[9px] font-bold",
            lowStock ? "text-rose-700" : "text-muted-foreground",
          )}
        >
          {stockLabel}: {formatStockLabel(product)}
        </p>
      </button>

      <button
        type="button"
        onClick={() => onPick(product)}
        disabled={locked}
        className={clsx(
          "pos-ds-product-cta mx-1.5 mb-1.5 min-h-[28px] rounded-lg px-2 py-1 text-[10px] font-black",
          locked ? "bg-muted text-muted-foreground" : "bg-waka-600 text-white active:bg-waka-700",
        )}
      >
        {locked ? lockedBadge : sellLabel}
      </button>
    </article>
  );
}
