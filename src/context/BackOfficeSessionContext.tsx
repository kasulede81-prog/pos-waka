import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePosStore } from "../store/usePosStore";

const STORAGE_KEY = "waka.bo.until";
const SESSION_MS = 15 * 60 * 1000;

function readStoredUntil(): number | null {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (!v) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= Date.now()) return null;
    return n;
  } catch {
    return null;
  }
}

type Ctx = {
  isUnlocked: boolean;
  /** Returns false if PIN wrong */
  unlockWithPin: (pin: string) => boolean;
  lock: () => void;
  /** Extend session while working in Back Office */
  touch: () => void;
};

const BackOfficeSessionContext = createContext<Ctx | null>(null);

export function BackOfficeSessionProvider({ children }: { children: ReactNode }) {
  const [until, setUntil] = useState<number | null>(() => readStoredUntil());

  const lock = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setUntil(null);
  }, []);

  const touch = useCallback(() => {
    setUntil((cur) => {
      if (cur === null || cur <= Date.now()) return cur;
      const next = Date.now() + SESSION_MS;
      try {
        sessionStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const unlockWithPin = useCallback((pin: string) => {
    const stored = usePosStore.getState().preferences.backOfficePin?.trim() ?? "";
    if (!stored) {
      return true;
    }
    const digits = pin.replace(/\D/g, "");
    if (digits !== stored) return false;
    const next = Date.now() + SESSION_MS;
    try {
      sessionStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
    setUntil(next);
    return true;
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setUntil((cur) => {
        if (cur === null) return cur;
        if (Date.now() >= cur) {
          try {
            sessionStorage.removeItem(STORAGE_KEY);
          } catch {
            /* ignore */
          }
          return null;
        }
        return cur;
      });
    }, 8000);
    return () => window.clearInterval(id);
  }, []);

  const isUnlocked = until !== null && Date.now() < until;

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
