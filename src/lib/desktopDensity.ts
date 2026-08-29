import { getPlatform } from "../platform/detect";
import type { WakaPlatform } from "../platform/types";
import { isNativeApp } from "./nativeApp";
import { WAKA_DESKTOP_MIN_PX, WAKA_MEDIA } from "./responsiveBreakpoints";

/** Document class — presentation only. Never set on Capacitor. */
export const DESKTOP_DENSITY_CLASS = "waka-desktop-density";

/** Virtualized table default on phone / native / web < 1024. */
export const MOBILE_TABLE_ROW_H = 44;

/** Virtualized table default when desktop density is on and the caller used the compact default. */
export const DESKTOP_TABLE_ROW_H = 50;

export type DesktopDensityInput = {
  platform: WakaPlatform;
  viewportWidth: number;
};

/**
 * Web ≥1024 and Electron always. Capacitor never, even at tablet/desktop CSS widths.
 */
export function shouldApplyDesktopDensity(input: DesktopDensityInput): boolean {
  if (input.platform === "mobile") return false;
  if (input.platform === "desktop") return true;
  return input.viewportWidth >= WAKA_DESKTOP_MIN_PX;
}

export function resolveDesktopDensityEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (isNativeApp()) return false;
  return shouldApplyDesktopDensity({
    platform: getPlatform(),
    viewportWidth: window.innerWidth,
  });
}

export function resolveEnterpriseTableRowHeight(
  estimateRowHeight: number | undefined,
  desktopDensity: boolean,
  mobileDefault = MOBILE_TABLE_ROW_H,
  desktopDefault = DESKTOP_TABLE_ROW_H,
): number {
  const requested = estimateRowHeight ?? mobileDefault;
  if (!desktopDensity) return requested;
  if (requested <= mobileDefault) return desktopDefault;
  return requested;
}

export function syncDesktopDensityClass(): boolean {
  const enabled = resolveDesktopDensityEnabled();
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle(DESKTOP_DENSITY_CLASS, enabled);
  }
  return enabled;
}

/** Before React paint — same pattern as theme bootstrap. */
export function bootstrapDesktopDensityClass(): void {
  syncDesktopDensityClass();
}

export function subscribeDesktopDensity(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handler = () => {
    syncDesktopDensityClass();
    onStoreChange();
  };

  const mq =
    typeof window.matchMedia === "function" ? window.matchMedia(WAKA_MEDIA.desktopUp) : null;
  mq?.addEventListener("change", handler);
  window.addEventListener("resize", handler);
  syncDesktopDensityClass();
  return () => {
    mq?.removeEventListener("change", handler);
    window.removeEventListener("resize", handler);
  };
}
