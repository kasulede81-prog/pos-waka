/** Max product grid columns on wide / ultrawide catalogs. */
export const POS_GRID_MAX_COLUMNS = 8;

/** Catalog container width breakpoints (px). */
export const POS_CATALOG_COL_BREAKPOINT_1600 = 1600;
export const POS_CATALOG_COL_BREAKPOINT_1200 = 1200;
export const POS_CATALOG_COL_BREAKPOINT_1000 = 1000;
export const POS_CATALOG_COL_BREAKPOINT_820 = 820;
export const POS_CATALOG_COL_BREAKPOINT_520 = 520;
export const POS_CATALOG_COL_BREAKPOINT_640 = 640;

/**
 * Product grid columns from measured catalog container width (not viewport).
 * Tuned for Windows POS terminals: 1024×768 → 4+ cols, 1280 → 5+, 1920 → 6–7, ultrawide → 8.
 */
export function catalogColumnCount(catalogWidthPx: number): number {
  const w = Math.max(0, catalogWidthPx);
  if (w >= POS_CATALOG_COL_BREAKPOINT_1600) return POS_GRID_MAX_COLUMNS;
  if (w >= POS_CATALOG_COL_BREAKPOINT_1200) return 7;
  if (w >= POS_CATALOG_COL_BREAKPOINT_1000) return 6;
  if (w >= POS_CATALOG_COL_BREAKPOINT_820) return 5;
  if (w >= POS_CATALOG_COL_BREAKPOINT_520) return 4;
  return 3;
}

/** @deprecated Use catalogColumnCount with measured container width. */
export function productGridColumnCount(viewportWidthPx: number): number {
  return catalogColumnCount(viewportWidthPx);
}
