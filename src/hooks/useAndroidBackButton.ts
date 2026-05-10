import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

/**
 * Hardware back: go back in web history when possible, otherwise home.
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    void App.addListener("backButton", () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        navigate("/", { replace: false });
      }
    }).then((h) => {
      handle = h;
    });
    return () => {
      void handle?.remove();
    };
  }, [navigate]);
}
