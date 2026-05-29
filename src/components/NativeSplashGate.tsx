import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { hideNativeSplashWhenReady } from "../lib/nativeSplash";

type Props = {
  /** Auth bootstrap finished (session known). */
  authReady: boolean;
  /** Signed-in owner/staff — POS shell still loading. */
  waitForPos: boolean;
};

/**
 * Hides the native splash once the first meaningful screen can render:
 * login/register when signed out, or after PosDataProvider when signed in.
 */
export function NativeSplashGate({ authReady, waitForPos }: Props) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!authReady) return;
    if (waitForPos) return;
    void hideNativeSplashWhenReady();
  }, [authReady, waitForPos]);

  return null;
}
