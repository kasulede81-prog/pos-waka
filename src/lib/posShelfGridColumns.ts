/**
 * Phase 32.3 — container-aware shelf grid columns.
 * Tiles keep a stable minimum width; column count grows with catalog width.
 * Do NOT size tiles by shelf name length.
 */

/** Minimum 1-column shelf tile width (px) — keeps rhythm on ultrawide. */
export const POS_SHELF_MIN_TILE_PX = 168;
/** Gap between shelf tiles (matches sm:gap-2 = 8px on Sell). */
export const POS_SHELF_GAP_PX = 8;
/** Hard max columns — ultrawide / 4K registers. */
export const POS_SHELF_MAX_COLUMNS = 12;
/** Phone portrait minimum. */
export const POS_SHELF_MIN_COLUMNS = 2;

export type ShelfColumnOptions = {
  /** Phone layout band — prefer 2-col portrait readability. */
  phoneBand?: boolean;
  isLandscape?: boolean;
};

/**
 * Shelf columns from measured catalog container width (not viewport).
 * Equal tile footprint; more columns as space grows (no 6-col ceiling).
 */
export function shelfColumnCount(catalogWidthPx: number, options?: ShelfColumnOptions): number {
  const w = Math.max(0, catalogWidthPx);

  if (options?.phoneBand) {
    return options.isLandscape ? 3 : POS_SHELF_MIN_COLUMNS;
  }

  if (w <= 0) return POS_SHELF_MIN_COLUMNS;

  const cols = Math.floor((w + POS_SHELF_GAP_PX) / (POS_SHELF_MIN_TILE_PX + POS_SHELF_GAP_PX));
  return Math.min(POS_SHELF_MAX_COLUMNS, Math.max(POS_SHELF_MIN_COLUMNS, cols));
}

/** CSS grid template for a measured shelf column count. */
export function shelfGridTemplateColumns(columnCount: number): string {
  const cols = Math.min(POS_SHELF_MAX_COLUMNS, Math.max(POS_SHELF_MIN_COLUMNS, columnCount));
  return `repeat(${cols}, minmax(0, 1fr))`;
}
