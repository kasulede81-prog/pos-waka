import { WAKA_TABLET_MIN_PX } from "./responsiveBreakpoints";

/** @deprecated Sidebar removed — use WAKA_TABLET_MIN_PX for bottom-chrome cutoff. */
export const TABLET_SIDEBAR_MIN_PX = WAKA_TABLET_MIN_PX;

/** Non-mobile POS / tablet chrome from 768px+ (compact + full desktop). */
export const POS_DESKTOP_LAYOUT_MIN_PX = WAKA_TABLET_MIN_PX;

export {
  WAKA_DESKTOP_MIN_PX as POS_FULL_DESKTOP_MIN_PX,
  WAKA_TABLET_MIN_PX,
} from "./responsiveBreakpoints";

/** @deprecated Sidebar removed. */
export function usesTabletSidebar(widthPx: number): boolean {
  return widthPx >= WAKA_TABLET_MIN_PX;
}

export function usesPosDesktopLayout(widthPx: number): boolean {
  return widthPx >= WAKA_TABLET_MIN_PX;
}
