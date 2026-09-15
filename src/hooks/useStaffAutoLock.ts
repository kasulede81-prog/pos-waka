import { useEffect, useRef } from "react";
import { usePosStore } from "../store/usePosStore";
import { lockPos, isStaffSessionExpired, touchStaffActivity, resolveStaffAutoLockMinutes, staffRequirePinAfterIdle } from "../lib/auth";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "scroll"] as const;

/** Idle auto-lock + session expiry enforcement. */
export function useStaffAutoLock(enabled: boolean): void {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const schedule = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      const state = usePosStore.getState();
      if (state.preferences.posLocked) return;

      const minutes = resolveStaffAutoLockMinutes(state.preferences);
      if (minutes <= 0 || !staffRequirePinAfterIdle(state.preferences)) return;

      timerRef.current = window.setTimeout(() => {
        const latest = usePosStore.getState();
        if (latest.preferences.posLocked) return;
        lockPos("auto");
      }, minutes * 60 * 1000);
    };

    const onActivity = () => {
      touchStaffActivity();
      schedule();
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    schedule();

    const expiryTimer = window.setInterval(() => {
      const state = usePosStore.getState();
      if (!isStaffSessionExpired(state.preferences)) return;
      if (state.preferences.posLocked) return;
      lockPos("session_expired");
    }, 60_000);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.clearInterval(expiryTimer);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity);
      }
    };
  }, [enabled]);
}

export function useStaffSessionBootstrap(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const state = usePosStore.getState();
    const prefs = state.preferences;
    if (prefs.staffRememberSession === false) return;
    if (isStaffSessionExpired(prefs)) {
      if (!prefs.posLocked && (prefs.activeStaffId || state.sessionActor?.userId.startsWith("staff:"))) {
        lockPos("session_expired");
      }
      return;
    }
    if (prefs.posLocked) {
      state.setPosLocked(false);
    }
    touchStaffActivity();
  }, [enabled]);
}
