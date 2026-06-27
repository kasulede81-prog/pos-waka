/** Max product grid columns on wide / ultrawide catalogs (enterprise desktop POS). */
export const POS_GRID_MAX_COLUMNS = 12;

/** Catalog container width breakpoints (px). */
export const POS_CATALOG_COL_BREAKPOINT_1900 = 1900;
export const POS_CATALOG_COL_BREAKPOINT_1400 = 1400;
export const POS_CATALOG_COL_BREAKPOINT_1160 = 1160;
export const POS_CATALOG_COL_BREAKPOINT_980 = 980;
export const POS_CATALOG_COL_BREAKPOINT_820 = 820;
export const POS_CATALOG_COL_BREAKPOINT_640 = 640;
export const POS_CATALOG_COL_BREAKPOINT_520 = 520;

/** @deprecated Use POS_CATALOG_COL_BREAKPOINT_1900 */
export const POS_CATALOG_COL_BREAKPOINT_1600 = POS_CATALOG_COL_BREAKPOINT_1900;
/** @deprecated Use POS_CATALOG_COL_BREAKPOINT_1400 */
export const POS_CATALOG_COL_BREAKPOINT_1200 = POS_CATALOG_COL_BREAKPOINT_1400;
/** @deprecated Use POS_CATALOG_COL_BREAKPOINT_980 */
export const POS_CATALOG_COL_BREAKPOINT_1000 = POS_CATALOG_COL_BREAKPOINT_980;

/**
 * Product grid columns from measured catalog container width (not viewport).
 * Tuned for enterprise desktop POS: 1366 → 8, 1600 → 9, 1920 → 10, 2560 → 12.
 */
export function catalogColumnCount(catalogWidthPx: number): number {
  const w = Math.max(0, catalogWidthPx);
  if (w >= POS_CATALOG_COL_BREAKPOINT_1900) return POS_GRID_MAX_COLUMNS;
  if (w >= POS_CATALOG_COL_BREAKPOINT_1400) return 10;
  if (w >= POS_CATALOG_COL_BREAKPOINT_1160) return 9;
  if (w >= POS_CATALOG_COL_BREAKPOINT_980) return 8;
  if (w >= POS_CATALOG_COL_BREAKPOINT_820) return 6;
  if (w >= POS_CATALOG_COL_BREAKPOINT_640) return 5;
  if (w >= POS_CATALOG_COL_BREAKPOINT_520) return 4;
  return 3;
}

/** @deprecated Use catalogColumnCount with measured container width. */
export function productGridColumnCount(viewportWidthPx: number): number {
  return catalogColumnCount(viewportWidthPx);
}
