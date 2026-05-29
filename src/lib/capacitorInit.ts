import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { initDeviceOnlineTracking } from "./deviceOnline";
import { prepareNativeSplash } from "./nativeSplash";
import { registerNativeOAuthDeepLinkHandler } from "./nativeGoogleAuth";

/**
 * Native shell polish: status bar matches Waka header (dark on light is inverted — we use dark bar + light icons).
 */
export async function initCapacitorShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  registerNativeOAuthDeepLinkHandler();
  await prepareNativeSplash();
  await initDeviceOnlineTracking();
  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: "#00000000" });
  } catch {
    /* older WebView or missing plugin */
  }
}
