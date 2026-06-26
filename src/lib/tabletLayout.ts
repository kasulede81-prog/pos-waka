import { POS_COMPACT_DESKTOP_MIN_PX, POS_FULL_DESKTOP_MIN_PX } from "./posLayoutMode";

/** Tailwind `md` breakpoint — sidebar nav from 768px+. */
export const TABLET_SIDEBAR_MIN_PX = 768;

/** Non-mobile POS / tablet chrome from 768px+ (compact + full desktop). */
export const POS_DESKTOP_LAYOUT_MIN_PX = POS_COMPACT_DESKTOP_MIN_PX;

/** POS two-column checkout sidebar from 1024px+. */
export { POS_FULL_DESKTOP_MIN_PX };

export function usesTabletSidebar(widthPx: number): boolean {
  return widthPx >= TABLET_SIDEBAR_MIN_PX;
}

export function usesPosDesktopLayout(widthPx: number): boolean {
  return widthPx >= POS_DESKTOP_LAYOUT_MIN_PX;
}
