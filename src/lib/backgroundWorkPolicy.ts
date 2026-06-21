import { isInternalAdminAppPath } from "./internalAdminPreview";

/** Routes where heavy cloud pull / merge is deferred to avoid WebView jank during selling. */
const DEFER_PULL_PREFIXES = ["/pos", "/stock", "/reports", "/customers", "/owner", "/sales-history"];

export function getPathname(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname || "/";
}

function isDeferPullRoute(pathname: string): boolean {
  return DEFER_PULL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Block full cloud pull, reconciliation, and heavy merge on POS and related routes. */
export function shouldPausePosBackgroundPull(pathname: string = getPathname()): boolean {
  if (isInternalAdminAppPath(pathname)) return true;
  return isDeferPullRoute(pathname);
}

/** Block push-only uploads (internal admin only — POS routes allow push). */
export function shouldPausePosBackgroundPush(pathname: string = getPathname()): boolean {
  return isInternalAdminAppPath(pathname);
}

/** @deprecated Prefer shouldPausePosBackgroundPull — pull pause, not push. */
export function shouldPausePosBackgroundWork(pathname: string = getPathname()): boolean {
  return shouldPausePosBackgroundPull(pathname);
}
