import { isDesktopPlatform } from "../platform";

/** True only in the Electron desktop shell — not web at wide viewport. */
export function isDesktopPosTerminal(): boolean {
  return isDesktopPlatform();
}

/** Catalog / checkout UI that matches full desktop density (Electron or wide web). */
export function isDesktopPosCatalogUi(isFullDesktopPos: boolean): boolean {
  return isFullDesktopPos || isDesktopPosTerminal();
}

/** Split catalog + checkout sidebar layout (Electron always; web when viewport is full). */
export function useDesktopPosSplitLayout(isFullDesktopPos: boolean): boolean {
  return isFullDesktopPos || isDesktopPosTerminal();
}

/** Web-only full desktop layout — unchanged browser POS at ≥1024px. */
export function isWebFullDesktopPos(isFullDesktopPos: boolean): boolean {
  return isFullDesktopPos && !isDesktopPosTerminal();
}
