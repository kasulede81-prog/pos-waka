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

  return (
    <SeoHead
      title={noIndexSeoTitle(path)}
      description="Waka POS — point of sale and inventory management for Ugandan businesses."
      path={path}
      noindex
    />
  );
}
