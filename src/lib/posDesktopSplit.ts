import { POS_FULL_DESKTOP_MIN_PX } from "./posLayoutMode";

/** Checkout column bounds for desktop POS split layout. */
export const POS_CHECKOUT_MIN_PX = 280;
export const POS_CHECKOUT_MAX_PX = 460;
/** Collapsed rail while browsing with an active sale (Phase 32.1). */
export const POS_CHECKOUT_RAIL_PX = 88;

export type PosSplitOptions = {
  /** Narrow rail — catalog keeps most of the width; checkout stays mounted. */
  collapsed?: boolean;
};

/**
 * Responsive checkout sidebar width (px) for full desktop POS.
 * Targets ~25–30% of viewport so the product catalog gets 70–75%.
 */
export function posCheckoutColumnWidthPx(
  viewportWidthPx: number,
  scaleMultiplier = 1,
  options?: PosSplitOptions,
): number {
  if (viewportWidthPx < POS_FULL_DESKTOP_MIN_PX) return 0;
  if (options?.collapsed) {
    return Math.round(Math.min(112, Math.max(POS_CHECKOUT_RAIL_PX, POS_CHECKOUT_RAIL_PX * scaleMultiplier)));
  }

  // Phase 32.3 — slightly narrower laptop checkout share so catalog density stays stable.
  let base: number;
  if (viewportWidthPx < 1280) {
    base = Math.round(Math.min(300, Math.max(POS_CHECKOUT_MIN_PX, viewportWidthPx * 0.24)));
  } else if (viewportWidthPx < 1920) {
    base = Math.round(Math.min(360, Math.max(300, viewportWidthPx * 0.24)));
  } else if (viewportWidthPx < 2560) {
    base = Math.round(Math.min(420, Math.max(340, viewportWidthPx * 0.24)));
  } else {
    base = Math.round(Math.min(POS_CHECKOUT_MAX_PX, Math.max(360, viewportWidthPx * 0.22)));
  }
  return Math.round(Math.min(POS_CHECKOUT_MAX_PX * scaleMultiplier, Math.max(POS_CHECKOUT_MIN_PX, base * scaleMultiplier)));
}

/**
 * CSS grid-template-columns for catalog + checkout split.
 * Catalog is always `minmax(0, 1fr)` so zoom/density reallocates into the fluid column.
 */
export function posSplitGridTemplateColumns(
  viewportWidthPx: number,
  scaleMultiplier = 1,
  options?: PosSplitOptions,
): string | null {
  const checkout = posCheckoutColumnWidthPx(viewportWidthPx, scaleMultiplier, options);
  if (!checkout) return null;
  if (options?.collapsed) {
    return `minmax(0, 1fr) ${checkout}px`;
  }
  // Fluid checkout with px floor/cap — reallocates under zoom instead of hard-only shrink
  const min = Math.min(checkout, POS_CHECKOUT_MIN_PX);
  const max = Math.max(checkout, POS_CHECKOUT_MIN_PX);
  const checkoutShare = viewportWidthPx < 1440 ? "26%" : "30%";
  return `minmax(0, 1fr) minmax(${min}px, min(${max}px, ${checkoutShare}))`;
}
