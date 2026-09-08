import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { initDeviceOnlineTracking } from "./deviceOnline";
import { prepareNativeSplash, scheduleSplashMaxDuration, scheduleSplashSafetyTimeout } from "./nativeSplash";
import { registerNativeAuthDeepLinkHandler } from "./nativeAuthDeepLink";
import { registerNativePrintDeepLinkHandler } from "./webPrintHandoff";

/**
 * Native shell polish: edge-to-edge system bars (Capacitor 8 SystemBars — no deprecated Window color APIs).
 */
export async function initCapacitorShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    // WAKA-04: the rest of this shell is native-only, but web/Electron still
    // need online tracking so reconnect can flip `getDeviceOnline()`.
    await initDeviceOnlineTracking();
    return;
  }
  document.documentElement.classList.add("waka-native");
  document.documentElement.classList.add(`waka-${Capacitor.getPlatform()}`);
  registerNativeAuthDeepLinkHandler();
  registerNativePrintDeepLinkHandler();
  await prepareNativeSplash();
  scheduleSplashMaxDuration();
  scheduleSplashSafetyTimeout();
  await initDeviceOnlineTracking();
  try {
    // Light icons on dark header areas (replaces legacy StatusBar Style.Light).
    await SystemBars.setStyle({ style: SystemBarsStyle.Dark });
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
