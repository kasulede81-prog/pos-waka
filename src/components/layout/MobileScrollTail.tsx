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

  const isPos = pathname === "/pos" || pathname.startsWith("/pos/");

  return (
    <div
      aria-hidden
      className={
        hideFab
          ? isPos
            ? "h-[var(--waka-scroll-tail-pos)] shrink-0 lg:hidden"
            : "h-[var(--waka-scroll-tail-default)] shrink-0 lg:hidden"
          : "h-[var(--waka-scroll-tail-default)] shrink-0 lg:hidden"
      }
    />
  );
}
