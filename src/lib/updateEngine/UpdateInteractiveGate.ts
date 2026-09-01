/**
 * ANDROID-UPDATE-P1 — overlay timing.
 *
 * The update overlay must never paint over the startup loading screen, the device
 * activation / recovery lock, or an auth transition. This module derives readiness
 * from signals that ALREADY exist outside the startup bootstrap:
 *   - `readStartupPerfMarks()` from src/lib/startupPerformance.ts — `first_interactive`
 *     / `dashboard_ready` are marked by PosDataProvider's finishReady().
 *   - the `data-startup-state` DOM attribute rendered by StartupLoadingScreen and
 *     DeviceActivationGateOutlet while a blocking startup surface is mounted.
 *
 * Nothing in PosDataProvider, the startup gates, or any ANDROID-STARTUP-P0 file is
 * modified or required to change: this is read-only consumption of existing signals.
 */
import { useEffect, useState } from "react";
import { readStartupPerfMarks } from "../startupPerformance";
import { shouldShowOverlay } from "./UpdateNotifications";
import type { UpdatePhase } from "./UpdatePlatformAdapter";

const INTERACTIVE_MARKS = new Set(["first_interactive", "dashboard_ready"]);

/** True once the POS shell has reported first interactivity. */
export function isAppInteractiveNow(): boolean {
  try {
    return readStartupPerfMarks().some((mark) => INTERACTIVE_MARKS.has(mark.phase));
  } catch {
    return false;
  }
}

/** True while a blocking startup / activation / recovery surface is on screen. */
export function isBlockingStartupSurfaceMounted(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.querySelector("[data-startup-state]") !== null;
  } catch {
    return false;
  }
}

/** Pure gate — testable without a DOM (T8). */
export function isUpdateOverlayAllowed(input: {
  phase: UpdatePhase;
  interactive: boolean;
  blockingSurfaceMounted: boolean;
}): boolean {
  if (input.phase === "idle") return false;
  if (!input.interactive) return false;
  if (input.blockingSurfaceMounted) return false;
  return true;
}

/**
 * The update check itself is never gated — only the overlay is. Startup does not wait
 * for, block on, or await anything in this module (T8).
 */
export function useUpdateOverlayReady(enabled: boolean, pollMs = 400): boolean {
  const [ready, setReady] = useState(
    () => enabled && isAppInteractiveNow() && !isBlockingStartupSurfaceMounted(),
  );
  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    const evaluate = () => {
      setReady(isAppInteractiveNow() && !isBlockingStartupSurfaceMounted());
    };
    evaluate();
    const id = setInterval(evaluate, pollMs);
    return () => clearInterval(id);
  }, [enabled, pollMs]);

  return ready;
}

/** T9 — Play overlays are Android-only. Overlay readiness is independent of evaluation. */
export function shouldRenderAndroidUpdateOverlay(input: {
  platform: string;
  overlayReady: boolean;
  phase: UpdatePhase;
}): boolean {
  if (input.platform !== "android") return false;
  if (!input.overlayReady) return false;
  if (!isUpdateOverlayAllowed({
    phase: input.phase,
    interactive: true,
    blockingSurfaceMounted: false,
  })) {
    return false;
  }
  return shouldShowOverlay(input.phase) || input.phase === "update_failed";
}
