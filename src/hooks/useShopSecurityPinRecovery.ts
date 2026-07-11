import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { getDeviceOnline } from "../lib/deviceOnline";
import {
  dismissShopSecurityPinRecoveryNotice,
  peekShopSecurityPinRecoveryNotice,
  scheduleShopSecurityPinRecovery,
} from "../lib/shopSecurityPinRecovery";

/** Run Shop Security PIN recovery on resume, reconnect, and expose owner notice state. */
export function useShopSecurityPinRecovery(shopId: string | null | undefined) {
  const [noticeAt, setNoticeAt] = useState<string | null>(() =>
    shopId ? peekShopSecurityPinRecoveryNotice(shopId) : null,
  );

  useEffect(() => {
    if (!shopId) {
      setNoticeAt(null);
      return;
    }
    setNoticeAt(peekShopSecurityPinRecoveryNotice(shopId));

    const onRecovery = (event: Event) => {
      const detail = (event as CustomEvent<{ shopId?: string; clearedAt?: string }>).detail;
      if (detail?.shopId === shopId) setNoticeAt(detail.clearedAt ?? peekShopSecurityPinRecoveryNotice(shopId));
    };
    const onDismiss = (event: Event) => {
      const detail = (event as CustomEvent<{ shopId?: string }>).detail;
      if (detail?.shopId === shopId) setNoticeAt(null);
    };

    window.addEventListener("waka:shop-security-pin-recovery", onRecovery);
    window.addEventListener("waka:shop-security-pin-recovery-dismissed", onDismiss);
    return () => {
      window.removeEventListener("waka:shop-security-pin-recovery", onRecovery);
      window.removeEventListener("waka:shop-security-pin-recovery-dismissed", onDismiss);
    };
  }, [shopId]);

  useEffect(() => {
    const onOnline = () => {
      if (!getDeviceOnline()) return;
      void scheduleShopSecurityPinRecovery("cloud_reconnect");
    };
    window.addEventListener("waka:network-online", onOnline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("waka:network-online", onOnline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible" || !getDeviceOnline()) return;
      void scheduleShopSecurityPinRecovery("app_resume");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sub = App.addListener("appStateChange", (state) => {
      if (state.isActive && getDeviceOnline()) {
        void scheduleShopSecurityPinRecovery("app_resume");
      }
    });
    return () => {
      void sub.then((handle) => handle.remove());
    };
  }, []);

  const dismissNotice = () => {
    if (!shopId) return;
    dismissShopSecurityPinRecoveryNotice(shopId);
    setNoticeAt(null);
  };

  return { noticeAt, dismissNotice };
}
