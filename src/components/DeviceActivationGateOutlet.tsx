import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Language } from "../types";
import { pathAllowedWhenDeviceBlocked, useDeviceActivation } from "../context/DeviceActivationContext";
import { t } from "../lib/i18n";

type Props = { lang: Language };

/** Blocks app routes until this device is activated/approved, except allowed paths. */
export function DeviceActivationGateOutlet({ lang }: Props) {
  const location = useLocation();
  const { loading, activated, block, retry } = useDeviceActivation();

  if (loading) {
    return (
      <div className="auth-scroll-root flex h-dvh max-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-waka-50 to-muted px-4 dark:from-foreground dark:to-foreground">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-waka-200 border-t-orange-600" aria-hidden />
        <p className="mt-3 text-sm font-semibold text-muted-foreground dark:text-muted-foreground">Checking device access…</p>
      </div>
    );
  }

  if (activated) {
    const path = location.pathname.split("?")[0] || "/";
    if (path === "/device-limit" || path === "/device-pending" || path === "/device-activating") {
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

  if (block?.kind === "connection") {
    return (
      <div className="auth-scroll-root flex h-dvh max-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-waka-50 to-muted px-6 dark:from-foreground dark:to-foreground">
        <h1 className="text-center text-xl font-black text-foreground dark:text-background">
          {t(lang, "deviceActivatingFailedNetwork")}
        </h1>
        <p className="mt-3 max-w-md text-center text-sm font-medium text-muted-foreground">
          {t(lang, "deviceActivatingFailedActivation")}
        </p>
        <button
          type="button"
          onClick={() => void retry()}
          className="mt-6 min-h-[48px] rounded-2xl bg-waka-600 px-6 text-sm font-black text-white"
        >
          {t(lang, "deviceActivatingRetry")}
        </button>
      </div>
    );
  }

  return <Navigate to="/device-pending" replace state={{ from: location.pathname }} />;
}
