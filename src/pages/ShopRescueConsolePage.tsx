import { Navigate, useLocation, useParams } from "react-router-dom";
import { isInternalAdminPreviewActive } from "../lib/internalAdminPreview";
import { shopConsoleTabFromLocation, shopConsoleTabHref } from "../lib/shopConsoleState";
import type { Language } from "../types";

type Props = {
  lang: Language;
  email: string | null | undefined;
};

/** @deprecated Use unified shop console at /internal/waka/shop/:shopId */
export function ShopRescueConsolePage(_props: Props) {
  const { shopId } = useParams<{ shopId: string }>();
  const location = useLocation();
  const previewMode = isInternalAdminPreviewActive(location.search);

  if (!shopId) {
    return <Navigate to="/internal/waka/shops" replace />;
  }

  const tab = shopConsoleTabFromLocation(location.search, location.hash, shopId);
  return <Navigate to={shopConsoleTabHref(shopId, tab, previewMode)} replace />;
}
