import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePosStore } from "../store/usePosStore";
import { resolveBackOfficeUnlock } from "../lib/backOfficeUnlock";
import type { UserRole } from "../types";
import { getOrCreateDeviceId } from "../lib/deviceId";

const AUTO_LOCK_MS = 3 * 60 * 1000;
/** Extending session on every tap re-rendered the whole app tree; throttle bumps while unlocked. */
const TOUCH_BUMP_MIN_MS = 25_000;
const TOUCH_BUMP_ALWAYS_IF_MS_LEFT = 45_000;

type Ctx = {
  isUnlocked: boolean;
  unlockedRole: UserRole | null;
  unlockedLabel: string | null;
  /** Returns false if secret wrong */
  unlockWithPin: (pin: string) => boolean;
  lock: () => void;
  touch: () => void;
};

const BackOfficeSessionContext = createContext<Ctx | null>(null);

export function BackOfficeSessionProvider({ children }: { children: ReactNode }) {
  const [unlockedUntil, setUnlockedUntil] = useState<number | null>(null);
  const [unlockedRole, setUnlockedRole] = useState<UserRole | null>(null);
  const [unlockedLabel, setUnlockedLabel] = useState<string | null>(null);
  const lastTouchBumpAtRef = useRef(0);

  const lock = useCallback(() => {
    setUnlockedUntil(null);
    setUnlockedRole(null);
    setUnlockedLabel(null);
  }, []);

  const touch = useCallback(() => {
    const now = Date.now();
    setUnlockedUntil((cur) => {
      if (cur === null) return cur;
      const msLeft = cur - now;
      if (msLeft < TOUCH_BUMP_ALWAYS_IF_MS_LEFT) {
        lastTouchBumpAtRef.current = now;
        return now + AUTO_LOCK_MS;
      }
      if (now - lastTouchBumpAtRef.current < TOUCH_BUMP_MIN_MS) {
        return cur;
      }
      lastTouchBumpAtRef.current = now;
      return now + AUTO_LOCK_MS;
    });
  }, []);

  const unlockWithPin = useCallback((pin: string) => {
    const state = usePosStore.getState();
    const result = resolveBackOfficeUnlock(pin, state.preferences, state.sessionActor);
    const deviceId = getOrCreateDeviceId();

    if (!result.ok) {
      usePosStore.getState().logAuditAction("back_office_unlock_failed", "Back Office unlock failed", {
        via: result.via,
        deviceId,
      });
      return false;
    }

    setUnlockedUntil(Date.now() + AUTO_LOCK_MS);
    setUnlockedRole(result.role);
    setUnlockedLabel(result.actorLabel);

    usePosStore.getState().logAuditAction("back_office_unlock_success", `Back Office unlocked as ${result.role}`, {
      via: result.via,
      unlockRole: result.role,
      unlockLabel: result.actorLabel,
      unlockUserId: result.actorUserId,
      staffId: result.staffId ?? null,
      deviceId,
    });
    return true;
  }, []);

  const isUnlocked = unlockedUntil !== null && unlockedUntil > Date.now();

  useEffect(() => {
    if (!unlockedUntil) return;
    const id = window.setInterval(() => {
      setUnlockedUntil((cur) => {
        if (cur && cur > Date.now()) return cur;
        setUnlockedRole(null);
        setUnlockedLabel(null);
        return null;
      });
    }, 10000);
    return () => window.clearInterval(id);
  }, [unlockedUntil]);

  const value = useMemo(
    () => ({
      isUnlocked,
      unlockedRole,
      unlockedLabel,
      unlockWithPin,
      lock,
      touch,
    }),
    [isUnlocked, unlockedRole, unlockedLabel, unlockWithPin, lock, touch],
  );

  return <BackOfficeSessionContext.Provider value={value}>{children}</BackOfficeSessionContext.Provider>;
}

export function useBackOfficeSession(): Ctx {
  const v = useContext(BackOfficeSessionContext);
  if (!v) throw new Error("useBackOfficeSession must be used within BackOfficeSessionProvider");
  return v;
}
