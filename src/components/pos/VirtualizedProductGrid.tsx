import { useRef, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import type { Product } from "../../types";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { usePosStore } from "../../store/usePosStore";
import { formatStockLabel } from "../../lib/sellingEngine";
import { shelfIconFor } from "../../lib/productCategories";
import { formatMedicineListPrimary, formatMedicineListSecondary } from "../../lib/pharmacyMedicine";
import { isPharmacyMode } from "../../lib/pharmacy";
import { DISPLAY_SCALE_META } from "../../lib/displayScale/scaleTokens";
import { useDisplayScale } from "../../context/DisplayScaleProvider";
import { PosSellProductCard } from "./PosSellProductCard";
import { PosDesktopProductCard } from "./PosDesktopProductCard";
import { PharmacySellMedicineCard } from "./PharmacySellMedicineCard";
import type { Language } from "../../types";

const ROW_ESTIMATE_DEFAULT = 148;
const ROW_ESTIMATE_SELL_MOBILE = 120;
const ROW_ESTIMATE_SELL_DESKTOP = 112;
const BOTTOM_SCROLL_GUTTER = 24;

type Props = {
  products: Product[];
  columnCount: number;
  onPick: (p: Product) => void;
  stockLabel: string;
  noShelfLabel: string;
  addLabel?: string;
  isLocked?: (p: Product) => boolean;
  lockedBadge?: string;
  variant?: "default" | "sellMobile" | "sellDesktop" | "pharmacyMedicine";
  favoriteIds?: Set<string>;
  onToggleFavorite?: (productId: string) => void;
  lang?: Language;
};

/** Scrolls long product lists smoothly; column count is set by measured catalog width. */
function VirtualizedProductGridInner({
  products,
  columnCount,
  onPick,
  stockLabel,
  noShelfLabel,
  addLabel = "+",
  isLocked,
  lockedBadge,
  variant = "default",
  favoriteIds,
  onToggleFavorite,
  lang,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { level: displayScaleLevel, featureEnabled: displayScaleOn } = useDisplayScale();
  const scaleMultiplier = displayScaleOn ? DISPLAY_SCALE_META[displayScaleLevel].multiplier : 1;
  const cols = Math.max(2, columnCount);
  const rowCount = Math.ceil(products.length / cols);
  const sellMobile = variant === "sellMobile";
  const sellDesktop = variant === "sellDesktop";
  const pharmacyMedicine = variant === "pharmacyMedicine";
  const baseRowEstimate = pharmacyMedicine
    ? 168
    : sellMobile
      ? ROW_ESTIMATE_SELL_MOBILE
      : sellDesktop
        ? ROW_ESTIMATE_SELL_DESKTOP
        : ROW_ESTIMATE_DEFAULT;
  const rowEstimate = Math.round(baseRowEstimate * scaleMultiplier);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () =>
      parentRef.current?.closest<HTMLElement>("[data-pos-catalog-scroll]") ??
      parentRef.current?.closest<HTMLElement>(".scroll-main-chrome") ??
      document.querySelector<HTMLElement>(".scroll-main-chrome"),
    estimateSize: () => rowEstimate,
    overscan: 5,
  });

  const gapClass = sellDesktop ? "gap-1.5" : sellMobile ? "gap-2" : "gap-2.5";

  return (
    <div ref={parentRef} className="w-full">
      <div
        className="relative w-full"
        style={{
          height: `${rowVirtualizer.getTotalSize() + BOTTOM_SCROLL_GUTTER}px`,
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const start = virtualRow.index * cols;
          const slice = products.slice(start, start + cols);
          return (
            <div
              key={virtualRow.key}
              className={clsx("absolute left-0 top-0 grid w-full px-0.5", gapClass)}
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                transform: `translateY(${virtualRow.start}px)`,
                height: `${virtualRow.size}px`,
              }}
            >
              {slice.map((p) => {
                const locked = isLocked?.(p) ?? false;
                if (pharmacyMedicine && lang) {
                  return (
                    <PharmacySellMedicineCard
                      key={p.id}
                      lang={lang}
                      product={p}
                      locked={locked}
                      lockedBadge={lockedBadge}
                      onPick={onPick}
                    />
                  );
                }
                if (sellMobile) {
                  return (
                    <PosSellProductCard
                      key={p.id}
                      product={p}
                      stockLabel={stockLabel}
                      addLabel={addLabel}
                      locked={locked}
                      lockedBadge={lockedBadge}
                      onPick={onPick}
                    />
                  );
                }
                if (sellDesktop) {
                  return (
                    <PosDesktopProductCard
                      key={p.id}
                      product={p}
                      stockLabel={stockLabel}
                      sellLabel={addLabel}
                      locked={locked}
                      lockedBadge={lockedBadge}
                      favorite={favoriteIds?.has(p.id)}
                      onPick={onPick}
                      onToggleFavorite={onToggleFavorite}
                    />
                  );
                }
                const preferences = usePosStore.getState().preferences;
                const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
                const detail = pharmacyMode ? formatMedicineListSecondary(p) : null;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onPick(p)}
                    className={clsx(
                      "relative flex min-h-[132px] flex-col justify-between rounded-2xl border p-3 text-left shadow-sm motion-reduce:transition-none",
                      locked
                        ? "border-border/80 bg-muted/90 opacity-55"
                        : "border-border bg-card shadow-md active:scale-[0.98] active:border-waka-500 active:shadow-sm",
                    )}
                    style={{ contentVisibility: "auto" }}
                  >
                    {locked && lockedBadge ? (
                      <span className="absolute right-2 top-2 rounded-full bg-foreground/90 px-1.5 py-0.5 text-[9px] font-black uppercase text-background">
                        {lockedBadge}
                      </span>
                    ) : null}
                    <span>
                      <span className="line-clamp-2 text-base font-black leading-tight text-foreground">
                        {formatMedicineListPrimary(p)}
                      </span>
                      {detail ? (
                        <span className="mt-0.5 block truncate text-[11px] font-bold text-muted-foreground">{detail}</span>
                      ) : null}
                      <span className="mt-0.5 block truncate text-[11px] font-bold text-muted-foreground">
                        {shelfIconFor(p.category ?? "") ? (
                          <span className="mr-1" aria-hidden>
                            {shelfIconFor(p.category ?? "")}
                          </span>
                        ) : null}
                        {(p.category ?? "").trim() || noShelfLabel}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-xs font-bold leading-snug text-muted-foreground">
                        {stockLabel}: {formatStockLabel(p)}
                      </span>
                    </span>
                    <span className="mt-2 text-sm font-black text-waka-700">{formatProductPriceLabel(p)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const VirtualizedProductGrid = memo(VirtualizedProductGridInner);
