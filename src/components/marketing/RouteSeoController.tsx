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
  const seoPath = path.startsWith("/loyalty/") ? "/loyalty" : path;
  const isLoyaltyCard = path.startsWith("/loyalty/");

  return (
    <SeoHead
      title={noIndexSeoTitle(path)}
      description="Waka POS — point of sale and inventory management for Ugandan businesses."
      path={seoPath}
      noindex
      usePosCanonical={isLoyaltyCard}
      referrerPolicy={isLoyaltyCard ? "no-referrer" : undefined}
    />
  );
}
