/** M1.3 / M1.4 / M1.4-R2 — short-shelf catalog presentation thresholds. */

/** Shelves at or below this product count get secondary catalog rails + end finish. */
export const MOBILE_SHORT_SHELF_MAX_PRODUCTS = 3;

/** Compact end cue band (no full secondary rails). */
export const MOBILE_SHELF_END_CUE_MIN = 4;
export const MOBILE_SHELF_END_CUE_MAX = 6;

/** Max other-shelf chips below a short shelf. */
export const MOBILE_SHORT_SHELF_OTHER_SHELVES_MAX = 6;

/** Max popular products on the compact discovery rail. */
export const MOBILE_SHORT_SHELF_POPULAR_MAX = 6;

export function isMobileShortShelf(productCount: number): boolean {
  return productCount > 0 && productCount <= MOBILE_SHORT_SHELF_MAX_PRODUCTS;
}

/** 4–6 products: optional tiny end cue only (no Popular / Other Shelves block). */
export function shouldShowMobileShelfEndCue(productCount: number): boolean {
  return productCount >= MOBILE_SHELF_END_CUE_MIN && productCount <= MOBILE_SHELF_END_CUE_MAX;
}
