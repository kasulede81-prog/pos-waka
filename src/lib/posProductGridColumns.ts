/** Max product grid columns until AppShell / checkout layout is redesigned. */
export const POS_GRID_MAX_COLUMNS = 6;

/** Catalog container width breakpoints (px). */
export const POS_CATALOG_COL_BREAKPOINT_1200 = 1200;
export const POS_CATALOG_COL_BREAKPOINT_900 = 900;
export const POS_CATALOG_COL_BREAKPOINT_700 = 700;

/**
 * Product grid columns from measured catalog container width (not viewport).
 * <700 → 3, 700–899 → 4, 900–1199 → 5, 1200+ → 6 (capped).
 */
export function catalogColumnCount(catalogWidthPx: number): number {
  const w = Math.max(0, catalogWidthPx);
  if (w >= POS_CATALOG_COL_BREAKPOINT_1200) return POS_GRID_MAX_COLUMNS;
  if (w >= POS_CATALOG_COL_BREAKPOINT_900) return 5;
  if (w >= POS_CATALOG_COL_BREAKPOINT_700) return 4;
  return 3;
}

/** @deprecated Use catalogColumnCount with measured container width. */
export function productGridColumnCount(viewportWidthPx: number): number {
  return catalogColumnCount(viewportWidthPx);
}
