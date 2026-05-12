import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePosStore } from "../store/usePosStore";
const AUTO_LOCK_MS = 3 * 60 * 1000;
/** Extending session on every tap re-rendered the whole app tree; throttle bumps while unlocked. */
const TOUCH_BUMP_MIN_MS = 25_000;
const TOUCH_BUMP_ALWAYS_IF_MS_LEFT = 45_000;

type Ctx = {
  isUnlocked: boolean;
  /** Returns false if secret wrong */
  unlockWithPin: (pin: string) => boolean;
  lock: () => void;
  touch: () => void;
};

const BackOfficeSessionContext = createContext<Ctx | null>(null);

export function BackOfficeSessionProvider({ children }: { children: ReactNode }) {
  const [unlockedUntil, setUnlockedUntil] = useState<number | null>(null);
  const lastTouchBumpAtRef = useRef(0);

  const lock = useCallback(() => {
    setUnlockedUntil(null);
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
    const stored = usePosStore.getState().preferences.backOfficePin?.trim() ?? "";
    const staff = usePosStore.getState().preferences.staffAccounts ?? [];
    const normalized = pin.trim();
    const digits = normalized.replace(/\D/g, "");
    const validStaff = staff.some(
      (s) => s.active && (s.role === "owner" || s.role === "manager") && ((s.pin && s.pin === digits) || (s.password && s.password === normalized)),
    );
    if (!stored) {
      if (validStaff || staff.length === 0) {
        setUnlockedUntil(Date.now() + AUTO_LOCK_MS);
        usePosStore.getState().logAuditAction("back_office_unlock", "Back Office unlocked", { via: validStaff ? "staff_secret" : "open_no_pin" });
        return true;
      }
      return false;
    }
    if (digits !== stored && !validStaff) return false;
    setUnlockedUntil(Date.now() + AUTO_LOCK_MS);
    usePosStore.getState().logAuditAction("back_office_unlock", "Back Office unlocked", {
      via: validStaff ? "staff_secret" : "pin",
    });
    return true;
  }, []);

  const isUnlocked = unlockedUntil !== null && unlockedUntil > Date.now();

  useEffect(() => {
    if (!unlockedUntil) return;
    const id = window.setInterval(() => {
      setUnlockedUntil((cur) => (cur && cur > Date.now() ? cur : null));
    }, 10000);
    return () => window.clearInterval(id);
  }, [unlockedUntil]);

  const value = useMemo(
    () => ({
      isUnlocked,
      unlockWithPin,
      lock,
      touch,
    }),
    [isUnlocked, unlockWithPin, lock, touch],
  );

  return <BackOfficeSessionContext.Provider value={value}>{children}</BackOfficeSessionContext.Provider>;
}

export function useBackOfficeSession(): Ctx {
  const v = useContext(BackOfficeSessionContext);
  if (!v) throw new Error("useBackOfficeSession must be used within BackOfficeSessionProvider");
  return v;
}
