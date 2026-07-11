import clsx from "clsx";
import { Plus } from "lucide-react";
import type { Product } from "../../types";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { formatStockLabel } from "../../lib/sellingEngine";

type Props = {
  product: Product;
  stockLabel: string;
  addLabel: string;
  locked?: boolean;
  lockedBadge?: string;
  onPick: (product: Product) => void;
};

/** Compact sell product tile — name, price, stock, + add. No images. */
export function PosSellProductCard({ product, stockLabel, addLabel, locked, lockedBadge, onPick }: Props) {
  const lowStock = product.stockOnHand <= product.minimumStockAlert;

  return (
    <article
      className={clsx(
        "pos-ds-product-card relative flex min-h-[108px] flex-col justify-between rounded-xl border p-2.5 text-left shadow-sm transition-all motion-reduce:transition-none",
        locked
          ? "border-border/80 bg-muted/90 opacity-55"
          : "border-border/90 bg-card active:scale-[0.98] active:border-waka-400 active:shadow-md motion-reduce:active:scale-100",
      )}
    >
      {locked && lockedBadge ? (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-foreground/90 px-1.5 py-0.5 text-[8px] font-black uppercase text-background">
          {lockedBadge}
        </span>
      ) : null}
      <div className="min-w-0 pr-1">
        <p className="pos-ds-product-name line-clamp-2 text-xs font-black leading-tight text-foreground">{product.name}</p>
        <p className="pos-ds-product-price mt-1 text-sm font-black text-teal-700">{formatProductPriceLabel(product)}</p>
        <span
          className={clsx(
            "pos-ds-product-stock mt-1 inline-block max-w-full truncate rounded-md px-1.5 py-0.5 text-[9px] font-bold",
            lowStock ? "bg-rose-50 text-rose-700" : "bg-muted text-muted-foreground",
          )}
        >
          {stockLabel}: {formatStockLabel(product)}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onPick(product)}
        disabled={locked}
        aria-label={addLabel}
        className={clsx(
          "pos-ds-product-cta mt-2 flex min-h-[36px] w-full items-center justify-center gap-1 rounded-lg text-xs font-black transition-colors",
          locked
            ? "border border-border bg-muted text-muted-foreground"
            : "bg-teal-700 text-white active:bg-teal-800",
        )}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
        {addLabel}
      </button>
    </article>
  );
}
