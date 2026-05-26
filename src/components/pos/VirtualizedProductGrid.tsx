import { useRef, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import type { Product } from "../../types";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { formatStockLabel } from "../../lib/sellingEngine";
import { shelfIconFor } from "../../lib/productCategories";

const COLS = 2;
const ROW_ESTIMATE = 132;
const BOTTOM_SCROLL_GUTTER = 24;

type Props = {
  products: Product[];
  onPick: (p: Product) => void;
  stockLabel: string;
  noShelfLabel: string;
  isLocked?: (p: Product) => boolean;
  lockedBadge?: string;
};

/** Scrolls long product lists smoothly on low-RAM phones (two columns). */
function VirtualizedProductGridInner({ products, onPick, stockLabel, noShelfLabel, isLocked, lockedBadge }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowCount = Math.ceil(products.length / COLS);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () =>
      parentRef.current?.closest<HTMLElement>(".scroll-main-chrome") ??
      document.querySelector<HTMLElement>(".scroll-main-chrome"),
    estimateSize: () => ROW_ESTIMATE,
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="w-full">
      <div
        className="relative w-full"
        style={{
          height: `${rowVirtualizer.getTotalSize() + BOTTOM_SCROLL_GUTTER}px`,
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const start = virtualRow.index * COLS;
          const slice = products.slice(start, start + COLS);
          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 top-0 grid w-full grid-cols-2 gap-2.5 px-0.5"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                height: `${virtualRow.size}px`,
              }}
            >
              {slice.map((p) => {
                const locked = isLocked?.(p) ?? false;
                return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPick(p)}
                  className={clsx(
                    "relative flex min-h-[122px] flex-col justify-between rounded-[1.35rem] border p-3 text-left shadow-sm motion-reduce:transition-none",
                    locked
                      ? "border-stone-200/80 bg-stone-50/90 opacity-55"
                      : "border-slate-200 bg-white active:scale-[0.98] active:border-waka-500",
                  )}
                  style={{ contentVisibility: "auto" }}
                >
                  {locked && lockedBadge ? (
                    <span className="absolute right-2 top-2 rounded-full bg-stone-800/90 px-1.5 py-0.5 text-[9px] font-black uppercase text-white">
                      {lockedBadge}
                    </span>
                  ) : null}
                  <span>
                    <span className="line-clamp-2 text-base font-black leading-tight text-slate-950">{p.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] font-bold text-stone-500">
                      {shelfIconFor(p.category ?? "") ? <span className="mr-1" aria-hidden>{shelfIconFor(p.category ?? "")}</span> : null}
                      {(p.category ?? "").trim() || noShelfLabel}
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-xs font-bold leading-snug text-slate-600">
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
