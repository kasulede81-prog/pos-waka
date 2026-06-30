import type { PosLayoutMode } from "./posLayoutMode";

/** Full desktop — checkout sidebar only when a sale is active (not empty cart). */
export function shouldMountDesktopCheckoutSidebar(
  layoutMode: PosLayoutMode,
  hasProducts: boolean,
  draftLineCount: number,
  saleCheckoutMinimized: boolean,
): boolean {
  return layoutMode === "full" && hasProducts && draftLineCount > 0 && !saleCheckoutMinimized;
}

/** Compact desktop — slide-over checkout from the right. */
export function shouldMountCompactCheckoutSlideover(
  layoutMode: PosLayoutMode,
  draftLineCount: number,
  saleCheckoutMinimized: boolean,
): boolean {
  return layoutMode === "compact" && draftLineCount > 0 && !saleCheckoutMinimized;
}

/** Mobile — full-screen checkout overlay. */
export function shouldMountMobileCheckoutOverlay(
  layoutMode: PosLayoutMode,
  draftLineCount: number,
  saleCheckoutMinimized: boolean,
): boolean {
  return layoutMode === "mobile" && draftLineCount > 0 && !saleCheckoutMinimized;
}

export function shouldShowMinimizedCheckoutFab(
  _layoutMode: PosLayoutMode,
  draftLineCount: number,
  saleCheckoutMinimized: boolean,
): boolean {
  return draftLineCount > 0 && saleCheckoutMinimized;
}

export function checkoutPanelsAreExclusive(
  mountDesktopSidebar: boolean,
  mountCompactSlideover: boolean,
  mountMobileOverlay: boolean,
): boolean {
  const mounted = [mountDesktopSidebar, mountCompactSlideover, mountMobileOverlay].filter(Boolean).length;
  return mounted <= 1;
}
