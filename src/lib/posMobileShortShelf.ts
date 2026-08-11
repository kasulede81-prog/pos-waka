/** M1.3 — short-shelf catalog presentation thresholds. */

/** Shelves at or below this product count get secondary catalog content / end state. */
export const MOBILE_SHORT_SHELF_MAX_PRODUCTS = 3;

/** Max other-shelf chips below a short shelf. */
export const MOBILE_SHORT_SHELF_OTHER_SHELVES_MAX = 6;

/** Max popular products (outside current shelf) shown below a short shelf. */
export const MOBILE_SHORT_SHELF_POPULAR_MAX = 4;

export function isMobileShortShelf(productCount: number): boolean {
  return productCount > 0 && productCount <= MOBILE_SHORT_SHELF_MAX_PRODUCTS;
}
