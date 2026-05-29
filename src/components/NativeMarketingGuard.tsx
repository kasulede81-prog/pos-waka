import { Navigate, Outlet } from "react-router-dom";
import { isNativeApp } from "../lib/nativeApp";

type Props = {
  isAuthenticated: boolean;
};

/** On Android/iOS, marketing pages are web-only; send users to the app entry instead. */
export function NativeMarketingGuard({ isAuthenticated }: Props) {
  if (!isNativeApp()) {
    return <Outlet />;
  }
  return <Navigate to={isAuthenticated ? "/" : "/login"} replace />;
}
