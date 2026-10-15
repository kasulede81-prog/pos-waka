import { useCallback, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import {
  createForegroundRefresher,
  DEFAULT_REFRESH_INTERVAL_MS,
  type ForegroundRefresher,
} from "../lib/foregroundRefresh";

type Options = {
  /** Periodic re-read while visible. Defaults to 60s. */
  intervalMs?: number;
  /** When false the surface is not refreshed at all (e.g. signed out). */
  enabled?: boolean;
  onError?: (error: unknown) => void;
};

/**
 * The single place this app decides to re-read a live surface.
 *
 * Wire a `run` in and the surface is refreshed when the tab or the native app
 * comes back to the foreground, and every `intervalMs` while it stays visible —
 * which is the only signal that reaches a POS terminal left open on one screen.
 * Do NOT add a second `visibilitychange` listener or a private `setInterval`
 * beside this: two mechanisms drift, and the pair that Capacitor fires on
 * Android resume would then produce two reads instead of one.
 *
 * `run` is read through a ref, so a caller may pass an inline closure without
 * re-arming the listeners on every render.
 *
 * WHEN THE SIGNAL COMES FROM SOMEWHERE ELSE — a Realtime event, say — call the
 * returned `poke`. Do NOT open your own channel and call `run` yourself: that is the
 * second mechanism this hook exists to prevent, it would skip the coalescing that
 * turns a burst of events into one read, and it would run on a hidden surface. `poke`
 * feeds the same scheduler as everything else, never arms the tick, and does nothing
 * at all while the surface is hidden.
 */
export function useForegroundRefresh(
  run: () => void | Promise<void>,
  options?: Options,
): () => void {
  const enabled = options?.enabled ?? true;
  const intervalMs = options?.intervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;

  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const refresherRef = useRef<ForegroundRefresher | null>(null);

  /** Stable across renders, and a no-op whenever the surface is disabled or unmounted. */
  const poke = useCallback((): void => {
    refresherRef.current?.poke();
  }, []);

  const onErrorRef = useRef(options?.onError);
  useEffect(() => {
    onErrorRef.current = options?.onError;
  }, [options?.onError]);

  useEffect(() => {
    if (!enabled) return;

    const refresher = createForegroundRefresher({
      run: () => runRef.current(),
      intervalMs,
      onError: (error) => onErrorRef.current?.(error),
    });
    refresherRef.current = refresher;

    const isVisible = (): boolean =>
      typeof document === "undefined" || document.visibilityState === "visible";

    // Arm the tick if we start visible. Deliberately does NOT run: the caller
    // owns its own initial load, and firing here would double every mount read.
    refresher.start(isVisible());

    const onVisibility = (): void => {
      if (isVisible()) refresher.resume();
      else refresher.hide();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    /**
     * Native resume. Capacitor fires `appStateChange` on Android, where the
     * WebView also fires its own `visibilitychange`; the refresher collapses the
     * pair into one read. The dynamic import keeps the plugin out of the web
     * bundle's critical path, and a build without it simply falls back to the
     * visibility path rather than throwing.
     */
    let cancelled = false;
    let removeNative: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      void import("@capacitor/app")
        .then(({ App }) =>
          App.addListener("appStateChange", ({ isActive }) => {
            if (isActive) refresher.resume();
            else refresher.hide();
          }),
        )
        .then((handle) => {
          if (cancelled) {
            void handle.remove();
            return;
          }
          removeNative = () => void handle.remove();
        })
        .catch(() => {
          /* No native lifecycle plugin in this build; visibility still applies. */
        });
    }

    return () => {
      cancelled = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      removeNative?.();
      // Cleared BEFORE stop(), so a poke arriving during teardown has nothing to
      // reach: `stop()` is what makes the refresher inert, and dropping the handle
      // first means a stale `poke` can never address a stopped surface.
      refresherRef.current = null;
      refresher.stop();
    };
  }, [enabled, intervalMs]);

  return poke;
}
