import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePosStore } from "../store/usePosStore";

type Ctx = {
  isUnlocked: boolean;
  /** Returns false if PIN wrong */
  unlockWithPin: (pin: string) => boolean;
  lock: () => void;
};

const BackOfficeSessionContext = createContext<Ctx | null>(null);

export function BackOfficeSessionProvider({ children }: { children: ReactNode }) {
  const [isUnlocked, setIsUnlocked] = useState(false);

  const lock = useCallback(() => {
    setIsUnlocked(false);
  }, []);

  const unlockWithPin = useCallback((pin: string) => {
    const stored = usePosStore.getState().preferences.backOfficePin?.trim() ?? "";
    if (!stored) {
      setIsUnlocked(true);
      return true;
    }
    const digits = pin.replace(/\D/g, "");
    if (digits !== stored) return false;
    setIsUnlocked(true);
    return true;
  }, []);

  const value = useMemo(
    () => ({
      isUnlocked,
      unlockWithPin,
      lock,
    }),
    [isUnlocked, unlockWithPin, lock],
  );

  return <BackOfficeSessionContext.Provider value={value}>{children}</BackOfficeSessionContext.Provider>;
}

export function useBackOfficeSession(): Ctx {
  const v = useContext(BackOfficeSessionContext);
  if (!v) throw new Error("useBackOfficeSession must be used within BackOfficeSessionProvider");
  return v;
}
