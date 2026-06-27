import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const VIRTUALIZE_THRESHOLD = 12;
const DEFAULT_ESTIMATE_ROW_PX = 96;
const BOTTOM_SCROLL_GUTTER = 24;

type Props<T> = {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  estimateRowPx?: number;
};

export function VirtualizedReceiptList<T>({
  items,
  renderItem,
  getKey,
  estimateRowPx = DEFAULT_ESTIMATE_ROW_PX,
}: Props<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () =>
      parentRef.current?.closest<HTMLElement>(".scroll-main-chrome") ??
      document.querySelector<HTMLElement>(".scroll-main-chrome") ??
      parentRef.current,
    estimateSize: () => estimateRowPx,
    overscan: 6,
  });

  if (items.length <= VIRTUALIZE_THRESHOLD) {
    return <div className="space-y-2">{items.map((item, index) => renderItem(item, index))}</div>;
  }

  return (
    <div ref={parentRef} className="w-full">
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize() + BOTTOM_SCROLL_GUTTER}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (!item) return null;
          return (
            <div
              key={getKey(item, virtualRow.index)}
              className="absolute left-0 top-0 w-full pb-2"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                height: `${virtualRow.size}px`,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
