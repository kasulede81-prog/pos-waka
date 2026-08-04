import type { ReactNode } from "react";

export type EnterpriseDataSortDir = "asc" | "desc";

export type EnterpriseDataColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** CSS grid track, e.g. `minmax(140px,2fr)` */
  width: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  /** Hide column below this Tailwind breakpoint (desktop table only) */
  hideBelow?: "lg" | "xl";
  className?: string;
};

export type EnterpriseDataSelectionApi = {
  enabled: boolean;
  selectedIds: ReadonlySet<string>;
  isSelected: (id: string) => boolean;
  setSelected: (id: string, selected: boolean) => void;
  selectIds: (ids: string[]) => void;
  clear: () => void;
  /** Select/deselect current visible page */
  toggleAll: (ids: string[], selected: boolean) => void;
};

export type EnterpriseDataTableProps<T> = {
  rows: T[];
  columns: EnterpriseDataColumn<T>[];
  rowKey: (row: T) => string;
  sortKey?: string | null;
  onSort?: (columnId: string) => void;
  selection?: EnterpriseDataSelectionApi;
  onRowActivate?: (row: T) => void;
  rowActions?: (row: T) => ReactNode;
  estimateRowHeight?: number;
  minWidthPx?: number;
  emptyState?: ReactNode;
  loading?: boolean;
  getRowClassName?: (row: T) => string | undefined;
  onVisibleIdsChange?: (ids: string[]) => void;
  ariaLabel?: string;
  className?: string;
  /** Focused row index for keyboard nav (controlled optional) */
  focusedIndex?: number;
  onFocusedIndexChange?: (index: number) => void;
};
