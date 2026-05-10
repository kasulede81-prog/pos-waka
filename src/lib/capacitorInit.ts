import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

/**
 * Native shell polish: status bar matches Waka header (dark on light is inverted — we use dark bar + light icons).
 */
export async function initCapacitorShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0f172a" });
  } catch {
    /* older WebView or missing plugin */
  }
}
