import { POS_FULL_DESKTOP_MIN_PX } from "./posLayoutMode";

/** Checkout column bounds for desktop POS split layout. */
export const POS_CHECKOUT_MIN_PX = 280;
export const POS_CHECKOUT_MAX_PX = 460;

/**
 * Responsive checkout sidebar width (px) for full desktop POS.
 * Targets ~25–30% of viewport so the product catalog gets 70–75%.
 */
export function posCheckoutColumnWidthPx(viewportWidthPx: number, scaleMultiplier = 1): number {
  if (viewportWidthPx < POS_FULL_DESKTOP_MIN_PX) return 0;

  let base: number;
  if (viewportWidthPx < 1280) {
    base = Math.round(Math.min(320, Math.max(POS_CHECKOUT_MIN_PX, viewportWidthPx * 0.28)));
  } else if (viewportWidthPx < 1920) {
    base = Math.round(Math.min(380, Math.max(300, viewportWidthPx * 0.26)));
  } else if (viewportWidthPx < 2560) {
    base = Math.round(Math.min(420, Math.max(340, viewportWidthPx * 0.24)));
  } else {
    base = Math.round(Math.min(POS_CHECKOUT_MAX_PX, Math.max(360, viewportWidthPx * 0.22)));
  }
  return Math.round(Math.min(POS_CHECKOUT_MAX_PX * scaleMultiplier, Math.max(POS_CHECKOUT_MIN_PX, base * scaleMultiplier)));
}

/** CSS grid-template-columns for catalog + checkout split. */
export function posSplitGridTemplateColumns(viewportWidthPx: number, scaleMultiplier = 1): string | null {
  const checkout = posCheckoutColumnWidthPx(viewportWidthPx, scaleMultiplier);
  if (!checkout) return null;
  return `minmax(0, 1fr) ${checkout}px`;
}
