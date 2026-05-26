import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { getBackFallbackPath, historyCanGoBack } from "../lib/navigationBack";

/**
 * Hardware back: go back in web history when possible, otherwise sensible parent route.
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    void App.addListener("backButton", () => {
      if (historyCanGoBack()) {
        navigate(-1);
      } else {
        navigate(getBackFallbackPath(location.pathname), { replace: false });
      }
    }).then((h) => {
      handle = h;
    });
    return () => {
      void handle?.remove();
    };
  }, [navigate, location.pathname]);
}
