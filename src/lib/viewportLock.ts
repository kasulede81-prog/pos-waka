import { PHARMACY_DISPENSE_ROUTE } from "./pharmacyNav";
import { isPosSellPath } from "./posSellExit";

/**
 * Routes that lock the AppShell scroll column and delegate scrolling to internal panes.
 * Matches POS full-screen operational layout pattern.
 */
export function isViewportLockedRoute(pathname: string): boolean {
  if (isPosSellPath(pathname)) return true;
  if (pathname.startsWith("/floor/order/")) return true;
  if (pathname === PHARMACY_DISPENSE_ROUTE) return true;
  if (pathname === "/floor") return true;
  if (pathname === "/kitchen" || pathname === "/expo") return true;
  return false;
}
