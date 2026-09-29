import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { isLoyaltySurface, isLoyaltySurfacePath, LOYALTY_SURFACE_HOME } from "../../lib/productHost";

/**
 * Phase 2C — the customer surface.
 *
 * On loyalty.waka.ug only the customer app renders. Every merchant POS route stays DECLARED and
 * untouched (nothing is deleted, `pos.waka.ug` is unaffected); on the loyalty host a path outside
 * `LOYALTY_SURFACE_PATHS` is redirected to the member home rather than rendered, so the merchant
 * shell, its navigation and its onboarding wizard are never reachable there.
 *
 * It wraps `<Routes>` rather than sitting inside it as a layout route. That is deliberate: a layout
 * route would mean re-parenting ~1,200 lines of merchant routes, and re-parenting them is exactly
 * the kind of change that can silently drop a route. This component renders `<Navigate>` INSTEAD of
 * the route tree, so the merchant tree is byte-for-byte what it was.
 *
 * It is an ALLOW list, so a merchant route added later is excluded by default rather than exposed
 * by accident. On any host that is not the loyalty surface it renders children unchanged, which is
 * every existing deployment including the Android shell.
 */
export function LoyaltySurfaceBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  if (!isLoyaltySurface()) return <>{children}</>;
  if (isLoyaltySurfacePath(pathname)) return <>{children}</>;

  return <Navigate to={LOYALTY_SURFACE_HOME} replace />;
}
