import { useRef, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Product } from "../../types";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { shelfIconFor } from "../../lib/productCategories";

const COLS = 2;
const ROW_ESTIMATE = 132;

type Props = {
  products: Product[];
  onPick: (p: Product) => void;
  stockLabel: string;
  noShelfLabel: string;
};

/** Scrolls long product lists smoothly on low-RAM phones (two columns). */
function VirtualizedProductGridInner({ products, onPick, stockLabel, noShelfLabel }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowCount = Math.ceil(products.length / COLS);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 5,
  });

  return (
    <div
      ref={parentRef}
      className="max-h-[min(540px,calc(100dvh-270px))] overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
    >
      <div
        className="relative w-full"
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
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
              {slice.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex min-h-[122px] flex-col justify-between rounded-[1.35rem] border border-slate-200 bg-white p-3 text-left shadow-sm active:scale-[0.98] active:border-waka-500 motion-reduce:transition-none"
                  style={{ contentVisibility: "auto" }}
                >
                  <span>
                    <span className="line-clamp-2 text-base font-black leading-tight text-slate-950">{p.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] font-bold text-stone-500">
                      {shelfIconFor(p.category ?? "") ? <span className="mr-1" aria-hidden>{shelfIconFor(p.category ?? "")}</span> : null}
                      {(p.category ?? "").trim() || noShelfLabel}
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-bold text-slate-600">
                      {stockLabel}: {Math.max(0, Math.floor(p.stockOnHand * 1000) / 1000)} {p.baseUnit}
                    </span>
                  </span>
                  <span className="mt-2 text-sm font-black text-waka-700">{formatProductPriceLabel(p)}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const VirtualizedProductGrid = memo(VirtualizedProductGridInner);
