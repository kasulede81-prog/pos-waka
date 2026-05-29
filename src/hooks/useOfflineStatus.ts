import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { getDeviceOnline } from "../lib/deviceOnline";

export function useOfflineStatus() {
  const [isOnline, setIsOnline] = useState(() => getDeviceOnline());

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      void import("@capacitor/network").then(({ Network }) => {
        void Network.getStatus().then((s) => setIsOnline(s.connected));
      });
      const onNative = (e: Event) => {
        const connected = (e as CustomEvent<{ connected: boolean }>).detail?.connected;
        if (typeof connected === "boolean") setIsOnline(connected);
      };
      window.addEventListener("waka:network-status", onNative);
      return () => window.removeEventListener("waka:network-status", onNative);
    }

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return { isOnline };
}
