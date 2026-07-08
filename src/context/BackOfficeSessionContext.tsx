import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePosStore } from "../store/usePosStore";
import { resolveBackOfficeUnlockAsync } from "../lib/backOfficeUnlock";
import type { UserRole } from "../types";
import { getOrCreateDeviceId } from "../lib/deviceId";
import {
  clearSecuritySession,
  createSecuritySession,
  getSecuritySession,
  subscribeSecuritySession,
  touchSecuritySession,
} from "../lib/enterpriseSecurity/securitySession";
import { backOfficeUnlockAuditLogger } from "../lib/enterpriseSecurity/audit";

type Ctx = {
  isUnlocked: boolean;
  unlockedRole: UserRole | null;
  unlockedLabel: string | null;
  /** Returns false if secret wrong */
  unlockWithPin: (pin: string) => Promise<boolean>;
  /** OS biometric verified — owner/manager session actors only. */
  unlockWithBiometric: () => boolean;
  lock: () => void;
  touch: () => void;
};

const BackOfficeSessionContext = createContext<Ctx | null>(null);

export function BackOfficeSessionProvider({ children }: { children: ReactNode }) {
  const [, bump] = useState(0);

  useEffect(() => subscribeSecuritySession(() => bump((n) => n + 1)), []);

  const session = getSecuritySession();
  const isUnlocked =
    session !== null &&
    (session.authorizedScopes.has("back_office_shell") || session.authorizedScopes.has("*"));
  const unlockedRole = isUnlocked ? session!.verifiedUser.role : null;
  const unlockedLabel = isUnlocked ? session!.verifiedUser.actorLabel : null;

  const lock = useCallback(() => {
    clearSecuritySession();
    bump((n) => n + 1);
  }, []);

  const touch = useCallback(() => {
    touchSecuritySession();
    bump((n) => n + 1);
  }, []);

  const unlockWithPin = useCallback(async (pin: string) => {
    const state = usePosStore.getState();
    const deviceId = getOrCreateDeviceId();
    const result = await resolveBackOfficeUnlockAsync(pin, state.preferences, state.sessionActor, deviceId);

    if (!result.ok) {
      backOfficeUnlockAuditLogger(false, { via: result.via, deviceId });
      return false;
    }

    createSecuritySession({
      scopes: ["back_office_shell", "*"],
      credential: result.via === "staff_pin" ? "staff_pin" : "shop_security_pin",
      user: {
        role: result.role,
        actorUserId: result.actorUserId,
        actorLabel: result.actorLabel,
        staffId: result.staffId,
      },
      deviceId,
      auditId: crypto.randomUUID(),
    });

    backOfficeUnlockAuditLogger(true, {
      via: result.via,
      unlockRole: result.role,
      unlockLabel: result.actorLabel,
      unlockUserId: result.actorUserId,
      staffId: result.staffId ?? null,
      deviceId,
    });
    bump((n) => n + 1);
    return true;
  }, []);

  const unlockWithBiometric = useCallback(() => {
    const state = usePosStore.getState();
    const actor = state.sessionActor;
    const role = actor?.role ?? "owner";
    if (role !== "owner" && role !== "manager") {
      return false;
    }
    const deviceId = getOrCreateDeviceId();
    createSecuritySession({
      scopes: ["back_office_shell", "*"],
      credential: "biometric",
      user: {
        role,
        actorUserId: actor?.userId ?? "unknown",
        actorLabel: actor?.displayName ?? role,
      },
      deviceId,
      auditId: crypto.randomUUID(),
    });
    backOfficeUnlockAuditLogger(true, {
      via: "biometric",
      unlockRole: role,
      unlockLabel: actor?.displayName ?? role,
      unlockUserId: actor?.userId ?? "unknown",
      deviceId,
    });
    bump((n) => n + 1);
    return true;
  }, []);

  const value = useMemo(
    () => ({
      isUnlocked: Boolean(isUnlocked),
      unlockedRole,
      unlockedLabel,
      unlockWithPin,
      unlockWithBiometric,
      lock,
      touch,
    }),
    [isUnlocked, unlockedRole, unlockedLabel, unlockWithPin, unlockWithBiometric, lock, touch],
  );

  return <BackOfficeSessionContext.Provider value={value}>{children}</BackOfficeSessionContext.Provider>;
}

export function useBackOfficeSession(): Ctx {
  const v = useContext(BackOfficeSessionContext);
  if (!v) throw new Error("useBackOfficeSession must be used within BackOfficeSessionProvider");
  return v;
}
