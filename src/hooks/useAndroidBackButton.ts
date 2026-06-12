import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { dispatchAndroidBack } from "../lib/androidBackStack";
import { getBackFallbackPath, historyCanGoBack } from "../lib/navigationBack";
import { confirmLeaveActiveSaleIfNeeded } from "../lib/posLeaveGuard";

const MINIMIZE_AT_ROOT_PATHS = new Set(["/", "/pos"]);

function shouldMinimizeApp(pathname: string, fallback: string): boolean {
  if (MINIMIZE_AT_ROOT_PATHS.has(pathname)) return true;
  return fallback === pathname;
}

/**
 * Hardware back: overlay handlers first, then history, then parent route, then minimize at root.
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    void App.addListener("backButton", () => {
      if (dispatchAndroidBack()) return;

      void (async () => {
        const leavingPos = location.pathname === "/pos" || location.pathname.startsWith("/pos/");
        if (leavingPos && !(await confirmLeaveActiveSaleIfNeeded())) return;

        if (historyCanGoBack()) {
          navigate(-1);
          return;
        }

        const fallback = getBackFallbackPath(location.pathname);
        if (shouldMinimizeApp(location.pathname, fallback)) {
          void App.minimizeApp();
          return;
        }

        navigate(fallback, { replace: false });
      })();
    }).then((h) => {
      handle = h;
    });
    return () => {
      void handle?.remove();
    };
  }, [navigate, location.pathname]);
}
