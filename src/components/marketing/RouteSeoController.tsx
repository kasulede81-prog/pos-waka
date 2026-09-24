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
  // B3 canonical is token-free https://loyalty.waka.ug/c
  const seoPath = path.startsWith("/c/") || path.startsWith("/loyalty/") ? "/c" : path;

  return (
    <SeoHead
      title={noIndexSeoTitle(path)}
      description="Waka POS — point of sale and inventory management for Ugandan businesses."
      path={seoPath}
      noindex
      useLoyaltyCanonical={isLoyaltyCard}
      referrerPolicy={isLoyaltyCard ? "no-referrer" : undefined}
    />
  );
}
