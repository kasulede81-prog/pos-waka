import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { initDeviceOnlineTracking } from "./deviceOnline";
import { prepareNativeSplash, scheduleSplashMaxDuration, scheduleSplashSafetyTimeout } from "./nativeSplash";
import { registerNativeAuthDeepLinkHandler } from "./nativeAuthDeepLink";

/**
 * Native shell polish: status bar matches Waka header (dark on light is inverted — we use dark bar + light icons).
 */
export async function initCapacitorShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  registerNativeAuthDeepLinkHandler();
  await prepareNativeSplash();
  scheduleSplashMaxDuration();
  scheduleSplashSafetyTimeout();
  await initDeviceOnlineTracking();
  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: "#00000000" });
  } catch {
    /* older WebView or missing plugin */
  }
  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
    await Keyboard.setScroll({ isDisabled: false });
  } catch {
    /* keyboard plugin optional on web */
  }
}
