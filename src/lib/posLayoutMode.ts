/** POS layout bands — shared JS breakpoints (do not rely on Tailwind alone). */

export const POS_MOBILE_MAX_PX = 767;
export const POS_COMPACT_DESKTOP_MIN_PX = 768;
/** Persistent catalog + checkout split from 1024px (POS terminals and laptops). */
export const POS_FULL_DESKTOP_MIN_PX = 1024;

export type PosLayoutMode = "mobile" | "compact" | "full";

export function resolvePosLayoutMode(widthPx: number): PosLayoutMode {
  if (widthPx <= POS_MOBILE_MAX_PX) return "mobile";
  if (widthPx < POS_FULL_DESKTOP_MIN_PX) return "compact";
  return "full";
}

export function isPosFullDesktop(widthPx: number): boolean {
  return widthPx >= POS_FULL_DESKTOP_MIN_PX;
}

export function isPosCompactDesktop(widthPx: number): boolean {
  return widthPx >= POS_COMPACT_DESKTOP_MIN_PX && widthPx < POS_FULL_DESKTOP_MIN_PX;
}

export function isPosMobile(widthPx: number): boolean {
  return widthPx <= POS_MOBILE_MAX_PX;
}
