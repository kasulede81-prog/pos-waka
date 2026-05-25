import { useLocation } from "react-router-dom";
import { isBackOfficePath } from "../../lib/backOfficePaths";

/**
 * Real block at the end of the scroll column (not padding on the scroller).
 * iOS Safari often treats padding-bottom as non-scrollable / non-clickable under fixed footers.
 */
export function MobileScrollTail() {
  const { pathname } = useLocation();
  const hideFab =
    pathname.startsWith("/pos") || pathname.startsWith("/internal/") || isBackOfficePath(pathname);

  return (
    <div
      aria-hidden
      className={
        hideFab
          ? "shrink-0 lg:hidden h-[calc(8.5rem+env(safe-area-inset-bottom,0px))]"
          : "shrink-0 lg:hidden h-[calc(13rem+env(safe-area-inset-bottom,0px))]"
      }
    />
  );
}
