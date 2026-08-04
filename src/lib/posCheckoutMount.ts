import type { PosLayoutMode } from "./posLayoutMode";

/**
 * Full desktop — checkout column stays mounted for the whole active sale.
 * Phase 32.1: `saleCheckoutMinimized` collapses density (rail), it does not unmount.
 */
export function shouldMountDesktopCheckoutSidebar(
  layoutMode: PosLayoutMode,
  hasProducts: boolean,
  draftLineCount: number,
  _saleCheckoutMinimized?: boolean,
): boolean {
  return layoutMode === "full" && hasProducts && draftLineCount > 0;
}

/** Compact desktop — slide-over checkout from the right (catalog remains visible). */
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

/**
 * Minimized FAB — mobile/compact only.
 * Full desktop uses a collapsed checkout rail instead (sidebar stays mounted).
 */
export function shouldShowMinimizedCheckoutFab(
  layoutMode: PosLayoutMode,
  draftLineCount: number,
  saleCheckoutMinimized: boolean,
): boolean {
  if (layoutMode === "full") return false;
  return draftLineCount > 0 && saleCheckoutMinimized;
}

/** Full desktop rail when sale is active but checkout is collapsed for browsing. */
export function shouldShowDesktopCheckoutRail(
  layoutMode: PosLayoutMode,
  draftLineCount: number,
  saleCheckoutMinimized: boolean,
): boolean {
  return layoutMode === "full" && draftLineCount > 0 && saleCheckoutMinimized;
}

export function checkoutPanelsAreExclusive(
  mountDesktopSidebar: boolean,
  mountCompactSlideover: boolean,
  mountMobileOverlay: boolean,
): boolean {
  const mounted = [mountDesktopSidebar, mountCompactSlideover, mountMobileOverlay].filter(Boolean).length;
  return mounted <= 1;
}
