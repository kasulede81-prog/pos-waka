import { isInternalAdminAppPath } from "./internalAdminPreview";

/** Sticky header Exit → main menu launcher (all viewports). */
export function shouldShowHeaderExit(pathname: string): boolean {
  if (isInternalAdminAppPath(pathname)) return false;
  if (pathname === "/") return false;
  if (pathname === "/pos" || pathname.startsWith("/pos/")) return false;
  return true;
}

/** Opened from the launcher or back office — full width, no primary sidebar/bottom tabs. */
export function isIndependentModuleRoute(pathname: string): boolean {
  return shouldShowHeaderExit(pathname);
}

/** Nested module pages keep an in-page back link (e.g. settings sub-screens). */
export function hasNestedModuleBack(pathname: string): boolean {
  return (
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/owner/") ||
    pathname.startsWith("/office/")
  );
}
