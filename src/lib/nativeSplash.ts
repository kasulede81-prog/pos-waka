import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { markStartupSplashHidden } from "./startupDiagnostics";

/** Brief brand flash — never block UX longer than this. */
export const SPLASH_MIN_VISIBLE_MS = 600;
/** Max native splash before React loading screen takes over. */
export const SPLASH_MAX_DURATION_MS = 2_500;
/** Absolute fallback if boot hangs — never infinite logo. */
export const SPLASH_SAFETY_TIMEOUT_MS = 10_000;

const bootAt = typeof performance !== "undefined" ? performance.now() : Date.now();
let hideStarted = false;
let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
let safetyTimeoutId: ReturnType<typeof setTimeout> | null = null;

function clearSplashTimers(): void {
  if (maxDurationTimer != null) {
    clearTimeout(maxDurationTimer);
    maxDurationTimer = null;
  }
  if (safetyTimeoutId != null) {
    clearTimeout(safetyTimeoutId);
    safetyTimeoutId = null;
  }
}

/** Keep Capacitor splash visible until UI is ready (login or POS shell). */
export async function prepareNativeSplash(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await SplashScreen.show({ autoHide: false, fadeInDuration: 0 });
  } catch {
    /* plugin optional on web */
  }
}

/** Force-hide splash — transitions to in-app Startup Loading Screen. */
export async function forceHideNativeSplash(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (hideStarted) return;
  hideStarted = true;
  clearSplashTimers();
  markStartupSplashHidden();
  try {
    await SplashScreen.hide({ fadeOutDuration: 320 });
  } catch {
    /* ignore */
  }
}

/** After max duration, always hide native splash so React loading UI is visible. */
export function scheduleSplashMaxDuration(): void {
  if (!Capacitor.isNativePlatform() || maxDurationTimer != null) return;
  maxDurationTimer = setTimeout(() => {
    maxDurationTimer = null;
    void forceHideNativeSplash();
  }, SPLASH_MAX_DURATION_MS);
}

/** Last-resort hide if startup deadlocks. */
export function scheduleSplashSafetyTimeout(onTimeout?: () => void): void {
  if (!Capacitor.isNativePlatform() || safetyTimeoutId != null) return;
  safetyTimeoutId = setTimeout(() => {
    safetyTimeoutId = null;
    void forceHideNativeSplash();
    onTimeout?.();
  }, SPLASH_SAFETY_TIMEOUT_MS);
}

export async function hideNativeSplashWhenReady(): Promise<void> {
  if (!Capacitor.isNativePlatform() || hideStarted) return;

  const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - bootAt;
  const waitForMin = Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);
  const waitForMax = Math.max(0, SPLASH_MAX_DURATION_MS - elapsed);
  const wait = Math.min(waitForMin, waitForMax);

  if (wait > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, wait);
    });
  }

  await forceHideNativeSplash();
}

export function isNativeSplashHidden(): boolean {
  return hideStarted;
}
