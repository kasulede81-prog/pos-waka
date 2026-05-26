import { useLocation } from "react-router-dom";
import { isBackOfficePath } from "../../lib/backOfficePaths";

/**
 * Real block at the end of the scroll column (not padding on the scroller).
 * iOS Safari often treats padding-bottom as non-scrollable / non-clickable under fixed footers.
 */
export function MobileScrollTail() {
  const { pathname } = useLocation();
  const isPos = pathname === "/pos" || pathname.startsWith("/pos/");
  const isBackOffice = isBackOfficePath(pathname);

  let tailClass = "h-[var(--waka-scroll-tail-default)] shrink-0 lg:hidden";
  if (isPos) {
    tailClass = "h-[var(--waka-scroll-tail-pos)] shrink-0 lg:hidden";
  } else if (isBackOffice) {
    tailClass = "h-[var(--waka-scroll-tail-back-office)] shrink-0 lg:hidden";
  }

  return <div aria-hidden className={tailClass} />;
}
