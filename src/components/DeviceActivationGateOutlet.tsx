import { Navigate, Outlet, useLocation } from "react-router-dom";
import { pathAllowedWhenDeviceBlocked, useDeviceActivation } from "../context/DeviceActivationContext";

/** Blocks app routes until this device is activated/approved, except allowed paths. */
export function DeviceActivationGateOutlet() {
  const location = useLocation();
  const { loading, activated, block } = useDeviceActivation();

  if (loading) {
    return (
      <div className="auth-scroll-root flex h-dvh max-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-waka-50 to-stone-50 px-4 dark:from-stone-950 dark:to-stone-900">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-waka-200 border-t-orange-600" aria-hidden />
        <p className="mt-3 text-sm font-semibold text-stone-700 dark:text-stone-300">Checking device access…</p>
      </div>
    );
  }

  if (activated) {
    const path = location.pathname.split("?")[0] || "/";
    if (path === "/device-limit" || path === "/device-pending") {
      return <Navigate to="/" replace />;
    }
    return <Outlet />;
  }

  const path = location.pathname.split("?")[0] || "/";
  if (pathAllowedWhenDeviceBlocked(path)) {
    return <Outlet />;
  }

  if (block?.kind === "pending") {
    return <Navigate to="/device-pending" replace state={{ from: location.pathname }} />;
  }

  if (block?.kind === "limit") {
    return <Navigate to="/device-limit" replace state={{ from: location.pathname }} />;
  }

  if (block?.kind === "revoked") {
    return <Navigate to="/device-pending" replace state={{ from: location.pathname, revoked: true }} />;
  }

  return <Navigate to="/device-limit" replace state={{ from: location.pathname }} />;
}
