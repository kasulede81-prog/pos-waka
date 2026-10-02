import { useLocation } from "react-router-dom";
import { isMarketingIndexablePath, noIndexSeoTitle, normalizePathname } from "../../config/seoRoutes";
import { SeoHead } from "./SeoHead";

/**
 * Applies noindex to every route that is not a public marketing/legal page.
 * Marketing pages set their own indexable SeoHead; this covers auth, demo, app, and admin.
 */
export function RouteSeoController() {
  const { pathname } = useLocation();
  const path = normalizePathname(pathname);

  if (isMarketingIndexablePath(path)) return null;

  // Capability URLs: never put public_card_token into canonical / og:url.
  const isLoyaltyCard = path.startsWith("/loyalty/") || path.startsWith("/c/");
  const isLoyaltyJoin = path.startsWith("/join/");
  // B3 canonical is token-free https://loyalty.waka.ug/c
  const seoPath =
    path.startsWith("/c/") || path.startsWith("/loyalty/")
      ? "/c"
      : path.startsWith("/join/")
        ? "/join"
        : path;

  return (
    <SeoHead
      title={noIndexSeoTitle(path)}
      description="DKASU POS — point of sale and inventory management for Ugandan businesses."
      path={seoPath}
      noindex
      // A loyalty page canonicalises to the loyalty origin; every other route is an APP route and
      // belongs on the POS origin. Without this they inherited the marketing origin, so an app
      // route like `/pos` advertised a canonical on the company site — a page that does not exist
      // there.
      useLoyaltyCanonical={isLoyaltyCard || isLoyaltyJoin}
      usePosCanonical={!isLoyaltyCard && !isLoyaltyJoin}
      referrerPolicy={isLoyaltyCard || isLoyaltyJoin ? "no-referrer" : undefined}
    />
  );
}
