import type { ReactNode } from "react";
import clsx from "clsx";

type Props = {
  children: ReactNode;
  /** Minimum table width before horizontal scroll (px). Omit for min-w-full. */
  minWidthPx?: number;
  className?: string;
  stickyHeader?: boolean;
};

/**
 * Desktop table shell: horizontal scroll when needed, sticky header, consistent row spacing.
 */
export function ResponsiveDataTable({
  children,
  minWidthPx,
  className,
  stickyHeader = true,
}: Props) {
  return (
    <div className={clsx("waka-data-table-shell", className)}>
      <table
        className={clsx("waka-data-table", stickyHeader && "waka-data-table--sticky-head")}
        style={minWidthPx ? { minWidth: `${minWidthPx}px` } : undefined}
      >
        {children}
      </table>
    </div>
  );
}
