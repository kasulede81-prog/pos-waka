import { useLocation } from "react-router-dom";
import { isBackOfficePath } from "../../lib/backOfficePaths";
import { isInternalAdminAppPath } from "../../lib/internalAdminPreview";
import { isIndependentModuleRoute } from "../../lib/headerExit";

/**
 * Real block at the end of the scroll column (not padding on the scroller).
 * iOS Safari often treats padding-bottom as non-scrollable / non-clickable under fixed footers.
 */
export function MobileScrollTail() {
  const { pathname } = useLocation();
  const isPos = pathname === "/pos" || pathname.startsWith("/pos/");
  const isStock = pathname === "/stock" || pathname.startsWith("/stock/");
  const isBackOffice = isBackOfficePath(pathname);
  const isInternalAdmin = isInternalAdminAppPath(pathname);
  const independentModule = isIndependentModuleRoute(pathname);

  if (isInternalAdmin) {
    return null;
  }

  if (independentModule) {
    return <div aria-hidden className="h-[calc(var(--waka-safe-bottom)+0.75rem)] shrink-0 md:hidden" />;
  }

  let tailClass = "h-[var(--waka-scroll-tail-default)] shrink-0 lg:hidden";
  if (isPos) {
    tailClass = "h-[var(--waka-scroll-tail-pos)] shrink-0 lg:hidden";
  } else if (isStock) {
    tailClass = "h-[var(--waka-scroll-tail-stock)] shrink-0 lg:hidden";
  } else if (isBackOffice) {
    tailClass = "h-[var(--waka-scroll-tail-back-office)] shrink-0 lg:hidden";
  }

  return <div aria-hidden className={tailClass} />;
}
