import { isInternalAdminAppPath } from "./internalAdminPreview";
import { PHARMACY_DISPENSE_ROUTE } from "./pharmacyNav";

/** Business-type terminal homes use the launcher tiles (not independent-module chrome). */
export function isTerminalLauncherPath(pathname: string): boolean {
  return pathname === "/";
}

/** Sticky header Exit → main menu launcher (all viewports). */
export function shouldShowHeaderExit(pathname: string): boolean {
  if (isInternalAdminAppPath(pathname)) return false;
  if (isTerminalLauncherPath(pathname)) return false;
  if (pathname === "/pos" || pathname.startsWith("/pos/")) return false;
  if (pathname === PHARMACY_DISPENSE_ROUTE) return false;
  return true;
}

/** Opened from the launcher or back office — full width, no bottom tabs. */
export function isIndependentModuleRoute(pathname: string): boolean {
  return shouldShowHeaderExit(pathname);
}

/** Nested module pages keep an in-page back link (e.g. settings sub-screens). */
export function hasNestedModuleBack(pathname: string): boolean {
  return (
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/owner/") ||
    pathname.startsWith("/office/") ||
    pathname.startsWith("/pharmacy/")
  );
}
