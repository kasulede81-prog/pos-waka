import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SaleLine } from "../../types";

const OVERSCAN = 10;
const BOTTOM_GUTTER = 8;

type Props = {
  lines: SaleLine[];
  estimateRowPx: number;
  renderRow: (line: SaleLine, index: number) => ReactNode;
  /** Extra class on the scroll viewport. */
  className?: string;
  listAriaLabel?: string;
};

/**
 * Phase 33.1 — windowed cart lines so 100–500+ items stay responsive.
 * Scroll ownership stays on this viewport; sticky totals must live outside.
 */
export function VirtualizedDraftCartList({
  lines,
  estimateRowPx,
  renderRow,
  className,
  listAriaLabel = "Cart lines",
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowPx,
    overscan: OVERSCAN,
    measureElement:
      typeof ResizeObserver !== "undefined"
        ? (el) => el.getBoundingClientRect().height
        : undefined,
  });

  if (lines.length === 0) return null;

  return (
    <div
      ref={parentRef}
      className={className}
      role="list"
      aria-label={listAriaLabel}
    >
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize() + BOTTOM_GUTTER}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const line = lines[virtualRow.index];
          if (!line) return null;
          return (
            <div
              key={line.productId}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              role="listitem"
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {renderRow(line, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
