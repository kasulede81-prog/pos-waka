import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { useVirtualizer } from "@tanstack/react-virtual";
import { WakaCheckbox } from "../WakaCheckbox";
import { EnterpriseSkeletonTable } from "../EnterpriseSkeleton";
import { useEnterpriseTableKeyboard } from "./useEnterpriseTableKeyboard";
import type { EnterpriseDataTableProps } from "./types";

const DEFAULT_ROW_H = 44;
const BOTTOM_SCROLL_GUTTER = 24;

function hideClass(hideBelow?: "lg" | "xl"): string | undefined {
  if (hideBelow === "lg") return "hidden lg:block";
  if (hideBelow === "xl") return "hidden xl:block";
  return undefined;
}

/**
 * Shared enterprise desktop data table — virtualized, sortable, selectable.
 * Extracted from Inventory table capabilities (Phase 30.1).
 * Use only on desktop workspaces (≥1024); keep mobile cards elsewhere.
 */
export function EnterpriseDataTable<T>({
  rows,
  columns,
  rowKey,
  sortKey,
  onSort,
  selection,
  onRowActivate,
  rowActions,
  estimateRowHeight = DEFAULT_ROW_H,
  minWidthPx = 960,
  emptyState,
  loading,
  getRowClassName,
  onVisibleIdsChange,
  ariaLabel,
  className,
  focusedIndex: focusedIndexProp,
  onFocusedIndexChange,
}: EnterpriseDataTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [focusedIndexLocal, setFocusedIndexLocal] = useState(0);
  const focusedIndex = focusedIndexProp ?? focusedIndexLocal;
  const setFocusedIndex = onFocusedIndexChange ?? setFocusedIndexLocal;

  const gridTemplate = useMemo(() => {
    const tracks: string[] = [];
    if (selection?.enabled) tracks.push("40px");
    for (const col of columns) tracks.push(col.width);
    if (rowActions) tracks.push("minmax(88px,120px)");
    return tracks.join(" ");
  }, [columns, selection?.enabled, rowActions]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () =>
      parentRef.current?.closest<HTMLElement>(".scroll-main-chrome") ??
      document.querySelector<HTMLElement>(".scroll-main-chrome") ??
      parentRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 8,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    onVisibleIdsChange?.(virtualItems.map((v) => {
      const row = rows[v.index];
      return row ? rowKey(row) : "";
    }).filter(Boolean));
  }, [virtualItems, rows, rowKey, onVisibleIdsChange]);

  useEffect(() => {
    if (focusedIndex >= rows.length) setFocusedIndex(Math.max(0, rows.length - 1));
  }, [focusedIndex, rows.length, setFocusedIndex]);

  const onKeyDown = useEnterpriseTableKeyboard({
    rows,
    rowKey,
    focusedIndex,
    onFocusedIndexChange: setFocusedIndex,
    onRowActivate,
    selection: selection?.enabled
      ? {
          enabled: true,
          setSelected: selection.setSelected,
          isSelected: selection.isSelected,
          selectIds: selection.selectIds,
          clear: selection.clear,
        }
      : undefined,
  });

  if (loading) {
    return <EnterpriseSkeletonTable rows={8} />;
  }

  if (rows.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  const visibleIds = rows.map(rowKey);
  const allSelected = selection?.enabled && visibleIds.length > 0 && visibleIds.every((id) => selection.isSelected(id));

  const headerCell = (label: ReactNode, colId: string, sortable?: boolean, align?: string, hideBelow?: "lg" | "xl") => {
    const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
    if (sortable && onSort) {
      return (
        <button
          type="button"
          onClick={() => onSort(colId)}
          className={clsx(
            "w-full text-[10px] font-bold uppercase tracking-wide",
            alignCls,
            hideClass(hideBelow),
            sortKey === colId ? "text-waka-700" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
          {sortKey === colId ? " ▾" : ""}
        </button>
      );
    }
    return (
      <div className={clsx("text-[10px] font-bold uppercase tracking-wide text-muted-foreground", alignCls, hideClass(hideBelow))}>
        {label}
      </div>
    );
  };

  return (
    <div
      ref={parentRef}
      role="grid"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={clsx(
        "w-full overflow-x-auto rounded-xl border border-border bg-card shadow-elev outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div style={{ minWidth: minWidthPx }}>
        <div
          role="row"
          className="sticky top-0 z-10 grid gap-2 border-b border-border bg-muted/95 px-3 py-2 backdrop-blur"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {selection?.enabled ? (
            <div className="flex items-center justify-center">
              <WakaCheckbox
                row={false}
                checked={Boolean(allSelected)}
                onCheckedChange={(checked) => selection.toggleAll(visibleIds, checked)}
                aria-label="Select all visible rows"
              />
            </div>
          ) : null}
          {columns.map((col) => (
            <div key={col.id} className={clsx(hideClass(col.hideBelow), col.className)}>
              {headerCell(col.header, col.id, col.sortable, col.align, col.hideBelow)}
            </div>
          ))}
          {rowActions ? (
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Actions</div>
          ) : null}
        </div>

        <div style={{ height: `${rowVirtualizer.getTotalSize() + BOTTOM_SCROLL_GUTTER}px`, position: "relative" }}>
          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            const id = rowKey(row);
            const selected = selection?.isSelected(id) ?? false;
            const focused = virtualRow.index === focusedIndex;
            return (
              <div
                key={id}
                role="row"
                aria-selected={selected || focused}
                className={clsx(
                  "group absolute left-0 top-0 grid w-full gap-2 border-b border-border/60 px-3 py-2 text-xs",
                  selected && "bg-waka-50/80 dark:bg-waka-950/30",
                  focused && "ring-1 ring-inset ring-waka-400/70",
                  getRowClassName?.(row),
                )}
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  height: `${virtualRow.size}px`,
                  gridTemplateColumns: gridTemplate,
                }}
                onClick={() => setFocusedIndex(virtualRow.index)}
                onDoubleClick={() => onRowActivate?.(row)}
              >
                {selection?.enabled ? (
                  <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                    <WakaCheckbox
                      row={false}
                      checked={selected}
                      onCheckedChange={(checked) => selection.setSelected(id, checked)}
                      aria-label={id}
                    />
                  </div>
                ) : null}
                {columns.map((col) => {
                  const alignCls = col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left";
                  const content = col.cell(row);
                  if (onRowActivate && col.id === columns[0]?.id) {
                    return (
                      <button
                        key={col.id}
                        type="button"
                        onClick={() => onRowActivate(row)}
                        className={clsx(
                          "truncate font-bold text-foreground hover:text-waka-700",
                          alignCls,
                          hideClass(col.hideBelow),
                          col.className,
                        )}
                      >
                        {content}
                      </button>
                    );
                  }
                  return (
                    <div
                      key={col.id}
                      className={clsx("truncate font-semibold text-muted-foreground", alignCls, hideClass(col.hideBelow), col.className)}
                    >
                      {content}
                    </div>
                  );
                })}
                {rowActions ? (
                  <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                    {rowActions(row)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
