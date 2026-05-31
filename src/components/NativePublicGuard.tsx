import { Navigate, Outlet, useLocation } from "react-router-dom";
import { isNativeApp, isVerifyAgentPath, NATIVE_PUBLIC_PATHS, unauthenticatedEntryPath } from "../lib/nativeApp";

type Props = {
  isAuthenticated: boolean;
};

/**
 * On Android/iOS, signed-out users only see auth + legal/support pages (footer links).
 * Everything else redirects to login.
 */
export function NativePublicGuard({ isAuthenticated }: Props) {
  const { pathname } = useLocation();

  if (!isNativeApp() || isAuthenticated) {
    return <Outlet />;
  }

  const path = pathname.split("?")[0] || "/";
  if (NATIVE_PUBLIC_PATHS.has(path) || isVerifyAgentPath(path)) {
    return <Outlet />;
  }

  return <Navigate to={unauthenticatedEntryPath()} replace />;
}
