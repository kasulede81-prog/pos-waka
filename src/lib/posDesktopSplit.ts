import { POS_FULL_DESKTOP_MIN_PX } from "./posLayoutMode";

/** Checkout column bounds for desktop POS split layout. */
export const POS_CHECKOUT_MIN_PX = 280;
export const POS_CHECKOUT_MAX_PX = 480;

/**
 * Responsive checkout sidebar width (px) for full desktop POS.
 * Narrow terminals (1024) get a slimmer column; ultrawide allows more room without starving the catalog.
 */
export function posCheckoutColumnWidthPx(viewportWidthPx: number): number {
  if (viewportWidthPx < POS_FULL_DESKTOP_MIN_PX) return 0;

  if (viewportWidthPx < 1280) {
    return Math.round(Math.min(340, Math.max(POS_CHECKOUT_MIN_PX, viewportWidthPx * 0.3)));
  }
  if (viewportWidthPx < 1920) {
    return Math.round(Math.min(400, Math.max(300, viewportWidthPx * 0.28)));
  }
  if (viewportWidthPx < 2560) {
    return Math.round(Math.min(440, Math.max(340, viewportWidthPx * 0.24)));
  }
  return Math.round(Math.min(POS_CHECKOUT_MAX_PX, Math.max(360, viewportWidthPx * 0.2)));
}

/** CSS grid-template-columns for catalog + checkout split. */
export function posSplitGridTemplateColumns(viewportWidthPx: number): string | null {
  const checkout = posCheckoutColumnWidthPx(viewportWidthPx);
  if (!checkout) return null;
  return `minmax(0, 1fr) ${checkout}px`;
}
