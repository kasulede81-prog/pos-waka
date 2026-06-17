import { useLocation } from "react-router-dom";
import { isInternalAdminAppPath } from "../../lib/internalAdminPreview";
import { resolveModuleExit } from "../../lib/moduleExit";

/**
 * Real block at the end of the scroll column (not padding on the scroller).
 * iOS Safari often treats padding-bottom as non-scrollable / non-clickable under fixed footers.
 */
export function MobileScrollTail() {
  const { pathname } = useLocation();
  const isPos = pathname === "/pos" || pathname.startsWith("/pos/");
  const isInternalAdmin = isInternalAdminAppPath(pathname);
  const moduleExit = resolveModuleExit(pathname);

  if (isInternalAdmin) {
    return null;
  }

  if (moduleExit) {
    return <div aria-hidden className="h-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+0.5rem)] shrink-0 lg:hidden" />;
  }

  if (isPos) {
    return <div aria-hidden className="h-[var(--waka-scroll-tail-pos)] shrink-0 lg:hidden" />;
  }

  return <div aria-hidden className="h-[calc(var(--waka-safe-bottom)+0.75rem)] shrink-0 lg:hidden" />;
}
