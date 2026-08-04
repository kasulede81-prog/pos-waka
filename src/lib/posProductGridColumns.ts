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

/** Phase 32.3 — min tile used when stabilizing density after checkout opens. */
export const POS_CATALOG_STABLE_MIN_TILE_PX = 100;
export const POS_CATALOG_STABLE_GAP_PX = 6;

/**
 * Phase 32.4.2 — max product card width on sparse shelves.
 * Prevents form-like horizontal stretching while keeping adaptive packing.
 */
export const POS_PRODUCT_CARD_MAX_WIDTH_PX = 228;

/**
 * Product grid columns from measured catalog container width (not viewport).
 * Tuned for enterprise desktop POS: 1366 → 8, 1600 → 9, 1920 → 10, 2560 → 12.
 * Phone band (Phase 28.1): portrait 2 / landscape 3 — identification over density.
 * Mid breakpoints densified (Phase 32.3) so laptop + open cart loses fewer columns.
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
  else if (w >= 860) cols = 7;
  else if (w >= POS_CATALOG_COL_BREAKPOINT_820) cols = 6;
  else if (w >= 680) cols = 6;
  else if (w >= POS_CATALOG_COL_BREAKPOINT_640) cols = 5;
  else if (w >= POS_CATALOG_COL_BREAKPOINT_520) cols = 4;

  const delta = options?.displayScale ? catalogColumnDeltaForScale(options.displayScale) : 0;
  return Math.min(POS_GRID_MAX_COLUMNS, Math.max(3, cols + delta));
}

/** Max columns that still fit a readable min tile width. */
export function catalogMaxColumnsForWidth(catalogWidthPx: number, minTilePx = POS_CATALOG_STABLE_MIN_TILE_PX): number {
  const w = Math.max(0, catalogWidthPx);
  if (w <= 0) return 3;
  return Math.max(3, Math.floor((w + POS_CATALOG_STABLE_GAP_PX) / (minTilePx + POS_CATALOG_STABLE_GAP_PX)));
}

/**
 * Stabilize column count when the catalog shrinks (e.g. checkout sidebar mounts).
 * Grow immediately; shrink only as far as min-tile geometry requires.
 */
export function stabilizeCatalogColumnCount(
  rawColumnCount: number,
  previousColumnCount: number | null | undefined,
  catalogWidthPx: number,
): number {
  const raw = Math.min(POS_GRID_MAX_COLUMNS, Math.max(3, rawColumnCount));
  if (previousColumnCount == null || previousColumnCount <= 0) return raw;
  if (raw >= previousColumnCount) return raw;
  const maxFit = Math.min(POS_GRID_MAX_COLUMNS, catalogMaxColumnsForWidth(catalogWidthPx));
  return Math.max(3, Math.min(previousColumnCount, maxFit));
}

/**
 * Phase 32.4.1 — when product count is below this floor, prefer sparse packing
 * so 1–few SKUs do not sit in an 8–12 column empty canvas.
 * Medium/large shelves (≥ floor) keep the dense enterprise grid.
 */
export const POS_SPARSE_PRODUCT_FLOOR = 8;

/**
 * Adapt dense column count to product count.
 * - 1 SKU → fewer columns (wider intentional card)
 * - 2–7 SKUs → columns ≈ count (balanced single row when possible)
 * - ≥8 or enough to fill dense grid → unchanged density
 */
export function sparseAwareCatalogColumnCount(denseColumnCount: number, productCount: number): number {
  const dense = Math.max(1, Math.min(POS_GRID_MAX_COLUMNS, Math.floor(denseColumnCount)));
  const n = Math.max(0, Math.floor(productCount));
  if (n <= 0) return dense;
  if (n >= POS_SPARSE_PRODUCT_FLOOR || n >= dense) return dense;

  // Narrow / phone band (2 cols): single SKU uses full width
  if (dense <= 2) {
    return n === 1 ? 1 : dense;
  }

  if (n === 1) {
    if (dense >= 8) return 3;
    if (dense >= 4) return 2;
    return dense;
  }

  // 2–7 products: fill a natural row without leftover empty tracks
  return Math.min(dense, n);
}

/** True when sparse packing applies (few products on a wider dense grid). */
export function isSparseProductCatalog(denseColumnCount: number, productCount: number): boolean {
  const dense = Math.max(1, Math.floor(denseColumnCount));
  const n = Math.max(0, Math.floor(productCount));
  if (n <= 0 || n >= POS_SPARSE_PRODUCT_FLOOR) return false;
  return n < dense || dense > 2;
}

/**
 * Phase 32.4.2 — grid template for product catalogs.
 * Sparse: fixed max card width + centered row (balanced proportions).
 * Dense: fluid 1fr tracks (enterprise density unchanged).
 */
export function catalogProductGridStyle(
  denseColumnCount: number,
  productCount: number,
): { columns: number; sparse: boolean; gridTemplateColumns: string; justifyContent?: "center" } {
  const columns = sparseAwareCatalogColumnCount(denseColumnCount, productCount);
  const sparse =
    productCount > 0 &&
    productCount < POS_SPARSE_PRODUCT_FLOOR &&
    denseColumnCount > 2;

  if (sparse) {
    return {
      columns,
      sparse: true,
      gridTemplateColumns: `repeat(${columns}, minmax(0, ${POS_PRODUCT_CARD_MAX_WIDTH_PX}px))`,
      justifyContent: "center",
    };
  }

  return {
    columns,
    sparse: false,
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
  };
}

/** @deprecated Use catalogColumnCount with measured container width. */
export function productGridColumnCount(viewportWidthPx: number): number {
  return catalogColumnCount(viewportWidthPx);
}
