import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";

const MIN_VISIBLE_MS = 900;
const bootAt = typeof performance !== "undefined" ? performance.now() : Date.now();
let hideStarted = false;

/** Keep Capacitor splash visible until UI is ready (login or POS shell). */
export async function prepareNativeSplash(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await SplashScreen.show({ autoHide: false, fadeInDuration: 0 });
  } catch {
    /* plugin optional on web */
  }
}

export async function hideNativeSplashWhenReady(): Promise<void> {
  if (!Capacitor.isNativePlatform() || hideStarted) return;
  hideStarted = true;

  const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - bootAt;
  const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
  if (wait > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, wait);
    });
  }

  try {
    await SplashScreen.hide({ fadeOutDuration: 280 });
  } catch {
    /* ignore */
  }
}
