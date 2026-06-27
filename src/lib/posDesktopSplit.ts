import { POS_FULL_DESKTOP_MIN_PX } from "./posLayoutMode";

/** Checkout column bounds for desktop POS split layout. */
export const POS_CHECKOUT_MIN_PX = 280;
export const POS_CHECKOUT_MAX_PX = 460;

/**
 * Responsive checkout sidebar width (px) for full desktop POS.
 * Targets ~25–30% of viewport so the product catalog gets 70–75%.
 */
export function posCheckoutColumnWidthPx(viewportWidthPx: number): number {
  if (viewportWidthPx < POS_FULL_DESKTOP_MIN_PX) return 0;

  if (viewportWidthPx < 1280) {
    return Math.round(Math.min(320, Math.max(POS_CHECKOUT_MIN_PX, viewportWidthPx * 0.28)));
  }
  if (viewportWidthPx < 1920) {
    return Math.round(Math.min(380, Math.max(300, viewportWidthPx * 0.26)));
  }
  if (viewportWidthPx < 2560) {
    return Math.round(Math.min(420, Math.max(340, viewportWidthPx * 0.24)));
  }
  return Math.round(Math.min(POS_CHECKOUT_MAX_PX, Math.max(360, viewportWidthPx * 0.22)));
}

/** CSS grid-template-columns for catalog + checkout split. */
export function posSplitGridTemplateColumns(viewportWidthPx: number): string | null {
  const checkout = posCheckoutColumnWidthPx(viewportWidthPx);
  if (!checkout) return null;
  return `minmax(0, 1fr) ${checkout}px`;
}
