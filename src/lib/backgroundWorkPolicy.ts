import { isInternalAdminAppPath } from "./internalAdminPreview";

/** Routes where background sync drains are deferred to avoid WebView jank during selling/navigation. */
const DEFER_SYNC_PREFIXES = ["/pos", "/stock", "/reports", "/customers", "/owner", "/sales-history"];

/** Pause POS cloud sync, queue flush, and presence while Waka staff use internal ops or heavy UI routes. */
export function shouldPausePosBackgroundWork(pathname: string = getPathname()): boolean {
  if (isInternalAdminAppPath(pathname)) return true;
  return DEFER_SYNC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function getPathname(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname || "/";
}
