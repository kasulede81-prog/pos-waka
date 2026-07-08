/**
 * Enterprise Responsive Standard — single canonical breakpoint contract.
 * All JS layout logic, CSS media queries, and Tailwind `md`/`lg` usage must align here.
 *
 * Tailwind mapping (defaults):
 *   sm 640  ·  md 768  ·  lg 1024  ·  xl 1280  ·  2xl 1536
 */

/** Phone portrait — max inclusive. */
export const WAKA_MOBILE_MAX_PX = 767;

/** Tablet / compact desktop — min inclusive. Matches Tailwind `md`. */
export const WAKA_TABLET_MIN_PX = 768;

/** Full desktop split layouts — min inclusive. Matches Tailwind `lg`. */
export const WAKA_DESKTOP_MIN_PX = 1024;

/** Wide POS checkout tiers. */
export const WAKA_POS_WIDE_MIN_PX = 1280;
export const WAKA_POS_ULTRA_MIN_PX = 1920;
export const WAKA_POS_4K_MIN_PX = 2560;

export type WakaLayoutBand = "mobile" | "tablet" | "desktop";

export function resolveWakaLayoutBand(widthPx: number): WakaLayoutBand {
  if (widthPx <= WAKA_MOBILE_MAX_PX) return "mobile";
  if (widthPx < WAKA_DESKTOP_MIN_PX) return "tablet";
  return "desktop";
}

/** @deprecated Prefer resolveWakaLayoutBand — kept for POS checkout compatibility. */
export type PosLayoutMode = "mobile" | "compact" | "full";

export function resolvePosLayoutMode(widthPx: number): PosLayoutMode {
  if (widthPx <= WAKA_MOBILE_MAX_PX) return "mobile";
  if (widthPx < WAKA_DESKTOP_MIN_PX) return "compact";
  return "full";
}

export function isWakaMobile(widthPx: number): boolean {
  return widthPx <= WAKA_MOBILE_MAX_PX;
}

export function isWakaTablet(widthPx: number): boolean {
  return widthPx >= WAKA_TABLET_MIN_PX && widthPx < WAKA_DESKTOP_MIN_PX;
}

export function isWakaDesktop(widthPx: number): boolean {
  return widthPx >= WAKA_DESKTOP_MIN_PX;
}

/** Match-media strings for hooks — keep in sync with CSS `@media` rules in index.css. */
export const WAKA_MEDIA = {
  mobile: `(max-width: ${WAKA_MOBILE_MAX_PX}px)`,
  tabletUp: `(min-width: ${WAKA_TABLET_MIN_PX}px)`,
  desktopUp: `(min-width: ${WAKA_DESKTOP_MIN_PX}px)`,
  posDesktopLayout: `(min-width: ${WAKA_TABLET_MIN_PX}px)`,
} as const;

/** Minimum touch targets by band (px). */
export const WAKA_TOUCH_MIN_PX: Record<WakaLayoutBand, number> = {
  mobile: 44,
  tablet: 48,
  desktop: 40,
};
