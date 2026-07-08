/** POS layout bands — re-exported from Enterprise Responsive Standard. */
export {
  WAKA_MOBILE_MAX_PX as POS_MOBILE_MAX_PX,
  WAKA_TABLET_MIN_PX as POS_COMPACT_DESKTOP_MIN_PX,
  WAKA_DESKTOP_MIN_PX as POS_FULL_DESKTOP_MIN_PX,
  resolvePosLayoutMode,
  type PosLayoutMode,
} from "./responsiveBreakpoints";

import {
  WAKA_DESKTOP_MIN_PX,
  WAKA_MOBILE_MAX_PX,
  WAKA_TABLET_MIN_PX,
} from "./responsiveBreakpoints";

export function isPosFullDesktop(widthPx: number): boolean {
  return widthPx >= WAKA_DESKTOP_MIN_PX;
}

export function isPosCompactDesktop(widthPx: number): boolean {
  return widthPx >= WAKA_TABLET_MIN_PX && widthPx < WAKA_DESKTOP_MIN_PX;
}

export function isPosMobile(widthPx: number): boolean {
  return widthPx <= WAKA_MOBILE_MAX_PX;
}
