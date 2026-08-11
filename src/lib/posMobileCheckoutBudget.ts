/**
 * M1.1-R5 — mobile Sell checkout full-screen workspace (documentation + regression anchors).
 * CSS source of truth: `.pos-mobile-checkout-workspace` in `src/index.css`.
 *
 * Viewport ownership: checkout owns 100dvh (no catalog peek).
 * Zones: header · cart (flex remainder, scrolls) · totals · payment · keypad/Complete (pin).
 */

/** Full-screen workspace class — owns height: 100dvh. */
export const POS_MOBILE_CHECKOUT_WORKSPACE_CLASS = "pos-mobile-checkout-workspace";

/** @deprecated R3/R4 sheet class — must not be used for phone checkout. */
export const POS_MOBILE_CHECKOUT_SHEET_CLASS = "pos-mobile-checkout-sheet";

/** Full viewport — never 72/88/90dvh partial sheets. */
export const POS_MOBILE_CHECKOUT_WORKSPACE_HEIGHT = "100dvh";

/** Catalog peek is intentionally zero in R5. */
export const POS_MOBILE_CHECKOUT_CATALOG_PEEK_DVH = 0;

/** Pinned zones that must remain outside the cart scroll container. */
export const POS_MOBILE_CHECKOUT_PINNED_ZONES = ["totals", "payment", "action"] as const;

/** Only cart lines are allowed to scroll away. */
export const POS_MOBILE_CHECKOUT_SCROLL_ZONE = "cart" as const;

/** Partial-height budgets that must not return. */
export const POS_MOBILE_CHECKOUT_FORBIDDEN_MAX_HEIGHTS = ["72dvh", "88dvh", "90dvh"] as const;
