/**
 * Phase 25.3 — POS catalog touch routing (presentation only).
 * Vertical catalog drags scroll; horizontal chip rows pan-x.
 */

/** Catalog shelf/product tiles inside [data-pos-catalog-scroll]. */
export const POS_CATALOG_TILE_TOUCH_CLASS = "touch-pan-y";

/** Horizontal quick-product / category chip rows. */
export const POS_HORIZONTAL_CHIP_TOUCH_CLASS = "touch-pan-x";

/** Checkout / cart internal scroll surfaces. */
export const POS_CHECKOUT_SCROLL_CLASS =
  "pos-checkout-scroll-pane touch-pan-y overscroll-y-contain [-webkit-overflow-scrolling:touch]";

/** Arrange-mode drag handles — keep manipulation for reorder. */
export const POS_ARRANGE_TOUCH_CLASS = "touch-manipulation";
