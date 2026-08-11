/** M1.1-R4 — mobile sheet cart item disclosure rules. */

/** Show every line without a View-all control when at or below this count. */
export const MOBILE_CHECKOUT_ITEMS_AUTO_SHOW_MAX = 3;

/** Preview rows when collapsed with 4+ products. */
export const MOBILE_CHECKOUT_ITEMS_COLLAPSED_PREVIEW = 3;

export type MobileCheckoutItemsVisibility = {
  /** Lines to render in the collapsed preview (ignored when showing all). */
  previewCount: number;
  /** True when the list needs View all / Collapse. */
  showDisclosure: boolean;
  /** Render the full editable list (auto for ≤3, or when expanded). */
  showAllLines: boolean;
};

export function resolveMobileCheckoutItemsVisibility(
  lineCount: number,
  expanded: boolean,
): MobileCheckoutItemsVisibility {
  const showDisclosure = lineCount > MOBILE_CHECKOUT_ITEMS_AUTO_SHOW_MAX;
  const showAllLines = !showDisclosure || expanded;
  return {
    previewCount: Math.min(lineCount, MOBILE_CHECKOUT_ITEMS_COLLAPSED_PREVIEW),
    showDisclosure,
    showAllLines,
  };
}
