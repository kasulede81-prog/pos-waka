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

/** Phone portrait catalog — prefer readability (Phase 28.1). */
export const POS_PHONE_PORTRAIT_COLUMNS = 2;
/** Phone landscape catalog. */
export const POS_PHONE_LANDSCAPE_COLUMNS = 3;

/** @deprecated Use POS_CATALOG_COL_BREAKPOINT_1900 */
export const POS_CATALOG_COL_BREAKPOINT_1600 = POS_CATALOG_COL_BREAKPOINT_1900;
/** @deprecated Use POS_CATALOG_COL_BREAKPOINT_1400 */
export const POS_CATALOG_COL_BREAKPOINT_1200 = POS_CATALOG_COL_BREAKPOINT_1400;
/** @deprecated Use POS_CATALOG_COL_BREAKPOINT_980 */
export const POS_CATALOG_COL_BREAKPOINT_1000 = POS_CATALOG_COL_BREAKPOINT_980;

import type { DisplayScaleLevel } from "./displayScale/scaleTokens";
import { catalogColumnDeltaForScale } from "./displayScale/scaleTokens";

export type CatalogColumnOptions = {
  displayScale?: DisplayScaleLevel;
  /**
   * Phone layout band (viewport ≤767). Forces 2-col portrait / 3-col landscape
   * so names stay readable (Phase 28.1). Tablet/desktop ignore this and stay adaptive.
   */
  phoneBand?: boolean;
  /** Used when phoneBand — landscape gets 3 columns. */
  isLandscape?: boolean;
};

/**
 * Product grid columns from measured catalog container width (not viewport).
 * Tuned for enterprise desktop POS: 1366 → 8, 1600 → 9, 1920 → 10, 2560 → 12.
 * Phone band (Phase 28.1): portrait 2 / landscape 3 — identification over density.
 */
export function catalogColumnCount(catalogWidthPx: number, options?: CatalogColumnOptions): number {
  if (options?.phoneBand) {
    return options.isLandscape ? POS_PHONE_LANDSCAPE_COLUMNS : POS_PHONE_PORTRAIT_COLUMNS;
  }

  const w = Math.max(0, catalogWidthPx);
  let cols = 3;
  if (w >= POS_CATALOG_COL_BREAKPOINT_1900) cols = POS_GRID_MAX_COLUMNS;
  else if (w >= POS_CATALOG_COL_BREAKPOINT_1400) cols = 10;
  else if (w >= POS_CATALOG_COL_BREAKPOINT_1160) cols = 9;
  else if (w >= POS_CATALOG_COL_BREAKPOINT_980) cols = 8;
  else if (w >= POS_CATALOG_COL_BREAKPOINT_820) cols = 6;
  else if (w >= POS_CATALOG_COL_BREAKPOINT_640) cols = 5;
  else if (w >= POS_CATALOG_COL_BREAKPOINT_520) cols = 4;

  const delta = options?.displayScale ? catalogColumnDeltaForScale(options.displayScale) : 0;
  return Math.min(POS_GRID_MAX_COLUMNS, Math.max(3, cols + delta));
}

/** @deprecated Use catalogColumnCount with measured container width. */
export function productGridColumnCount(viewportWidthPx: number): number {
  return catalogColumnCount(viewportWidthPx);
}
