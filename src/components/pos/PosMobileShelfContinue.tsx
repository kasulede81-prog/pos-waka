import clsx from "clsx";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import type { PosShelfDisplayCard } from "../../lib/posShelfLayout";
import { formatShelfDisplayLabel, formatShelfProductCountLabel } from "../../lib/posShelfDisplayLabel";
import { shelfIconFor } from "../../lib/productCategories";
import { PosSellProductCard } from "./PosSellProductCard";
import { isProductPlanLocked } from "../../lib/productPlanLock";

type Props = {
  lang: Language;
  otherShelves: PosShelfDisplayCard[];
  onShelfTap: (key: string) => void;
  popularProducts: Product[];
  onPickProduct: (product: Product) => void;
  onBackToShelves: () => void;
  stockLabel: string;
  addLabel: string;
  lockedBadge: string;
  lockedIds: Set<string>;
  cartQtyByProductId: Map<string, number>;
};

/**
 * M1.3 — secondary catalog content under short shelves (1–3 products).
 * Only renders sections when real data exists; otherwise a compact end-of-shelf cue.
 */
export function PosMobileShelfContinue({
  lang,
  otherShelves,
  onShelfTap,
  popularProducts,
  onPickProduct,
  onBackToShelves,
  stockLabel,
  addLabel,
  lockedBadge,
  lockedIds,
  cartQtyByProductId,
}: Props) {
  const hasPopular = popularProducts.length > 0;
  const hasOtherShelves = otherShelves.length > 0;
  const hasAny = hasPopular || hasOtherShelves;

  return (
    <div className="mt-3 space-y-3 border-t border-border/70 pt-3" data-pos-short-shelf-continue>
      {hasPopular ? (
        <section aria-label={t(lang, "posSellLandingPopular")}>
          <p className="px-0.5 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
            {t(lang, "posSellLandingPopular")}
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {popularProducts.map((product) => (
              <PosSellProductCard
                key={`short-shelf-pop-${product.id}`}
                product={product}
                stockLabel={stockLabel}
                addLabel={addLabel}
                locked={isProductPlanLocked(product.id, lockedIds)}
                lockedBadge={lockedBadge}
                cartQty={cartQtyByProductId.get(product.id) ?? 0}
                onPick={onPickProduct}
              />
            ))}
          </div>
        </section>
      ) : null}

      {hasOtherShelves ? (
        <section aria-label={t(lang, "posSellOtherShelves")}>
          <p className="px-0.5 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
            {t(lang, "posSellOtherShelves")}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {otherShelves.map((shelf) => {
              const icon = shelfIconFor(shelf.label);
              return (
                <button
                  key={shelf.key}
                  type="button"
                  onClick={() => onShelfTap(shelf.key)}
                  className={clsx(
                    "inline-flex min-h-[44px] max-w-full items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2",
                    "text-left text-xs font-black text-foreground shadow-sm active:bg-muted",
                  )}
                >
                  {icon ? (
                    <span aria-hidden className="shrink-0">
                      {icon}
                    </span>
                  ) : null}
                  <span className="min-w-0 truncate">{formatShelfDisplayLabel(shelf.label)}</span>
                  <span className="shrink-0 text-[10px] font-bold text-muted-foreground">
                    {formatShelfProductCountLabel(lang, shelf.count)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="flex flex-col items-stretch gap-2 pb-1">
        {!hasAny ? (
          <p className="px-0.5 text-center text-xs font-semibold text-muted-foreground">
            {t(lang, "posSellEndOfShelf")}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onBackToShelves}
          className="min-h-[44px] w-full rounded-xl border border-waka-300 bg-card px-3 text-sm font-black text-waka-900 shadow-sm active:bg-waka-50"
        >
          {t(lang, "posBackToShelves")}
        </button>
      </div>
    </div>
  );
}
