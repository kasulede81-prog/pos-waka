import { isNativeApp } from "./nativeApp";

export const NATIVE_PERSIST_DEBOUNCE_MS = 3_500;
export const WEB_PERSIST_DEBOUNCE_MS = 500;

export function persistDebounceMs(): number {
  return isNativeApp() ? NATIVE_PERSIST_DEBOUNCE_MS : WEB_PERSIST_DEBOUNCE_MS;
}

/** Yield so React can paint (longer timeout on native WebView). */
export function yieldUiTick(): Promise<void> {
  return new Promise((resolve) => {
    if (isNativeApp()) {
      setTimeout(resolve, 16);
      return;
    }
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 32 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** Run work when the browser is idle — avoids jank during scroll/tap. */
export function runWhenIdle(fn: () => void, timeoutMs = isNativeApp() ? 2500 : 1200): void {
  if (typeof window === "undefined") {
    fn();
    return;
  }
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => fn(), { timeout: timeoutMs });
  } else {
    setTimeout(fn, 0);
  }
}

export function nativeSyncResumeDelayMs(): number {
  return isNativeApp() ? 4500 : 2500;
}

export function nativeVisibilitySyncDelayMs(): number {
  return isNativeApp() ? 3500 : 2500;
}
