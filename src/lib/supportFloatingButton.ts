import { isPosSellPath } from "./posSellExit";

export type SupportFloatingButtonVisibility = {
  pathname: string;
  authenticated: boolean;
  posLocked: boolean;
  internalAdminRoute: boolean;
};

/**
 * The floating support entry point is a persistent, shop-wide shortcut into the
 * merchant Support Center. It must never compete with dense transactional UI or
 * duplicate an already-open support surface, so it hides on:
 * - the sell workspace (its own help host owns that surface),
 * - every /support-center/* route (the destination is already on screen),
 * - sign-in / lock surfaces and the internal admin app.
 */
export function shouldShowSupportFloatingButton(v: SupportFloatingButtonVisibility): boolean {
  if (!v.authenticated) return false;
  if (v.posLocked) return false;
  if (v.internalAdminRoute) return false;
  if (v.pathname.startsWith("/support-center")) return false;
  if (v.pathname.startsWith("/login")) return false;
  if (isPosSellPath(v.pathname)) return false;
  return true;
}

/** Badge count caps at 9+ so the FAB stays visually balanced. */
export function supportFloatingBadgeLabel(total: number): string {
  if (total <= 0) return "";
  return total > 9 ? "9+" : String(total);
}
