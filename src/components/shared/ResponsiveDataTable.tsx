import type { ReactNode } from "react";
import clsx from "clsx";

export type ResponsiveTableColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Hide this column below sm breakpoint (shown in mobile card instead). */
  hideOnMobile?: boolean;
  className?: string;
};

type Props<T> = {
  rows: T[];
  columns: ResponsiveTableColumn<T>[];
  rowKey: (row: T) => string;
  /** Minimum table width before horizontal scroll (px). */
  minWidthPx?: number;
  className?: string;
  stickyHeader?: boolean;
  emptyState?: ReactNode;
};

/**
 * Enterprise Responsive Table — sticky header, horizontal scroll, optional mobile cards.
 */
export function EnterpriseResponsiveTable<T>({
  rows,
  columns,
  rowKey,
  minWidthPx,
  className,
  stickyHeader = true,
  emptyState,
}: Props<T>) {
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  const desktopColumns = columns.filter((c) => !c.hideOnMobile);
  const mobileExtraColumns = columns.filter((c) => c.hideOnMobile);

  return (
    <>
      <div className={clsx("waka-data-table-shell hidden sm:block", className)}>
        <table
          className={clsx("waka-data-table", stickyHeader && "waka-data-table--sticky-head")}
          style={minWidthPx ? { minWidth: `${minWidthPx}px` } : undefined}
        >
          <thead>
            <tr>
              {desktopColumns.map((col) => (
                <th key={col.id} className={col.className}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {desktopColumns.map((col) => (
                  <td key={col.id} className={col.className}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className="rounded-xl border border-border bg-card p-3 shadow-sm"
          >
            <div className="space-y-1">
              {columns.map((col) => (
                <div key={col.id} className="flex items-start justify-between gap-2 text-sm">
                  <span className="shrink-0 font-bold text-muted-foreground">{col.header}</span>
                  <span className="min-w-0 text-right font-semibold text-foreground">{col.cell(row)}</span>
                </div>
              ))}
              {mobileExtraColumns.length === 0 ? null : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** @deprecated Use EnterpriseResponsiveTable — thin wrapper for existing call sites. */
export function ResponsiveDataTable({
  children,
  minWidthPx,
  className,
  stickyHeader = true,
}: {
  children: ReactNode;
  minWidthPx?: number;
  className?: string;
  stickyHeader?: boolean;
}) {
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
