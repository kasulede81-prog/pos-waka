/** Desktop persistent checkout sidebar — mutually exclusive with mobile overlay. */
export function shouldMountDesktopCheckoutSidebar(isDesktopPos: boolean, hasProducts: boolean): boolean {
  return isDesktopPos && hasProducts;
}

export function shouldMountMobileCheckoutOverlay(
  isDesktopPos: boolean,
  draftLineCount: number,
  saleCheckoutMinimized: boolean,
): boolean {
  return !isDesktopPos && draftLineCount > 0 && !saleCheckoutMinimized;
}

export function checkoutPanelsAreExclusive(mountDesktopSidebar: boolean, mountMobileOverlay: boolean): boolean {
  return !(mountDesktopSidebar && mountMobileOverlay);
}
