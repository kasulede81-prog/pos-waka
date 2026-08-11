import clsx from "clsx";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import type { PosShelfDisplayCard } from "../../lib/posShelfLayout";
import { formatShelfDisplayLabel, formatShelfProductCountLabel } from "../../lib/posShelfDisplayLabel";
import { shelfIconFor } from "../../lib/productCategories";
import { isProductPlanLocked } from "../../lib/productPlanLock";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { POS_HORIZONTAL_CHIP_TOUCH_CLASS } from "../../lib/posTouchInteraction";

type Props = {
  lang: Language;
  otherShelves: PosShelfDisplayCard[];
  onShelfTap: (key: string) => void;
  popularProducts: Product[];
  onPickProduct: (product: Product) => void;
  onBackToShelves: () => void;
  addLabel: string;
  lockedIds: Set<string>;
};

/**
 * M1.4 / M1.4-R2 — secondary catalog under short shelves.
 * Open-shelf products (parent) stay the hero. Popular + Other Shelves are compact rails.
 * Remaining viewport is finished with a deliberate end-of-shelf zone (not a blank void).
 */
export function PosMobileShelfContinue({
  lang,
  otherShelves,
  onShelfTap,
  popularProducts,
  onPickProduct,
  onBackToShelves,
  addLabel,
  lockedIds,
}: Props) {
  const hasPopular = popularProducts.length > 0;
  const hasOtherShelves = otherShelves.length > 0;
  const hasAny = hasPopular || hasOtherShelves;

  return (
    <div
      className="mt-3 flex min-h-0 flex-1 flex-col border-t border-border/70 pt-2.5"
      data-pos-short-shelf-continue
    >
      <div className="shrink-0 space-y-2.5">
        {hasPopular ? (
          <section aria-label={t(lang, "posSellLandingPopular")}>
            <p className="pos-ds-shelf-heading px-0.5 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
              {t(lang, "posSellLandingPopular")}
            </p>
            <div
              className={clsx(
                "mt-1 flex gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]",
                POS_HORIZONTAL_CHIP_TOUCH_CLASS,
              )}
              role="list"
            >
              {popularProducts.map((product) => {
                const locked = isProductPlanLocked(product.id, lockedIds);
                return (
                  <button
                    key={`short-shelf-pop-${product.id}`}
                    type="button"
                    role="listitem"
                    disabled={locked}
                    onClick={() => onPickProduct(product)}
                    aria-label={`${addLabel}: ${product.name}`}
                    className={clsx(
                      "pos-ds-quick-chip flex min-h-[44px] max-w-[10.5rem] shrink-0 flex-col justify-center rounded-xl border px-3 py-1.5 text-left shadow-sm",
                      locked
                        ? "cursor-not-allowed border-border/70 bg-muted/80 opacity-55"
                        : "border-border bg-card active:border-waka-300 active:bg-waka-50",
                    )}
                  >
                    <span className="truncate text-xs font-black leading-tight text-foreground">{product.name}</span>
                    <span className="mt-0.5 truncate text-[10px] font-bold tabular-nums text-teal-800">
                      {formatProductPriceLabel(product)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {hasOtherShelves ? (
          <section aria-label={t(lang, "posSellOtherShelves")}>
            <p className="pos-ds-shelf-heading px-0.5 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
              {t(lang, "posSellOtherShelves")}
            </p>
            <div
              className={clsx(
                "mt-1 flex gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]",
                POS_HORIZONTAL_CHIP_TOUCH_CLASS,
              )}
              role="list"
            >
              {otherShelves.map((shelf) => {
                const icon = shelfIconFor(shelf.label);
                return (
                  <button
                    key={shelf.key}
                    type="button"
                    role="listitem"
                    onClick={() => onShelfTap(shelf.key)}
                    aria-label={formatShelfDisplayLabel(shelf.label)}
                    className={clsx(
                      "inline-flex min-h-[44px] max-w-[11rem] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2",
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
      </div>

      {/* M1.4-R2 — deliberate end composition fills remaining column (not a blank void). */}
      <div
        className="pos-mobile-shelf-end-finish mt-2 flex min-h-[7.5rem] flex-1 flex-col justify-center px-1"
        data-pos-short-shelf-end-finish
      >
        <div className="flex flex-col items-center gap-2 py-3 text-center">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">
            {t(lang, "posSellEndOfShelf")}
          </p>
          {hasAny ? (
            <button
              type="button"
              onClick={onBackToShelves}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl px-3 text-sm font-black text-waka-800 active:bg-muted"
            >
              {t(lang, "posSellExploreAnotherShelf")} →
            </button>
          ) : (
            <button
              type="button"
              onClick={onBackToShelves}
              className="min-h-[44px] w-full max-w-xs rounded-xl border border-waka-300 bg-card px-3 text-sm font-black text-waka-900 shadow-sm active:bg-waka-50"
            >
              {t(lang, "posBackToShelves")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** M1.4 — tiny end cue for 4–6 product shelves (no secondary rails). */
export function PosMobileShelfEndCue({
  lang,
  onBackToShelves,
}: {
  lang: Language;
  onBackToShelves: () => void;
}) {
  return (
    <div
      className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 px-0.5 pt-2"
      data-pos-shelf-end-cue
    >
      <p className="text-[11px] font-semibold text-muted-foreground">{t(lang, "posSellEndOfShelf")}</p>
      <button
        type="button"
        onClick={onBackToShelves}
        className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-2.5 text-xs font-black text-waka-800 active:bg-muted"
      >
        ← {t(lang, "posSellLandingShelves")}
      </button>
    </div>
  );
}
