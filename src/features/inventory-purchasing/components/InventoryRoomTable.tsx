import type { ReactNode } from "react";
import clsx from "clsx";

export type InventoryRoomColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  hideBelow?: "lg" | "xl";
  align?: "left" | "right";
  className?: string;
};

type Props<T> = {
  rows: T[];
  columns: InventoryRoomColumn<T>[];
  rowKey: (row: T) => string;
  minWidthPx?: number;
  ariaLabel: string;
  getRowClassName?: (row: T) => string;
  onRowActivate?: (row: T) => void;
};

export function InventoryRoomTable<T>({
  rows,
  columns,
  rowKey,
  minWidthPx = 720,
  ariaLabel,
  getRowClassName,
  onRowActivate,
}: Props<T>) {
  return (
    <div className="inventory-room-table hidden sm:block">
      <table className="inventory-room-table__table" style={{ minWidth: `${minWidthPx}px` }} aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                className={clsx(
                  col.align === "right" && "text-right",
                  col.hideBelow === "lg" && "hidden lg:table-cell",
                  col.hideBelow === "xl" && "hidden xl:table-cell",
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={clsx(getRowClassName?.(row), onRowActivate && "inventory-room-table__row--active")}
              onClick={onRowActivate ? () => onRowActivate(row) : undefined}
            >
              {columns.map((col) => (
                <td
                  key={col.id}
                  className={clsx(
                    col.align === "right" && "text-right",
                    col.hideBelow === "lg" && "hidden lg:table-cell",
                    col.hideBelow === "xl" && "hidden xl:table-cell",
                    col.className,
                  )}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
