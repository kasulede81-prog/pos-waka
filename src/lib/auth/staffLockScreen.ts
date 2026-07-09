/**
 * Phase 13.2 — lock / unlock orchestration for enterprise lock screen.
 */

import type { ShopPreferences, StaffAccount } from "../../types";
import { normalizePin, staffSecretMatchesAsync } from "../staffSecret";
import { verifyShopSecurityPin } from "../enterpriseSecurity/EnterpriseSecurityService";
import { activeStaffCanUnlock, canLockPos } from "../lockPos";
import { usePosStore } from "../../store/usePosStore";
import { logStaffSessionAudit } from "./staffSessionAudit";
import {
  clearUnlockFailures,
  getUnlockLockoutStatus,
  recordUnlockFailure,
  unlockLimiterScope,
} from "./staffLoginLimiter";
import { resolveStaffMaxFailedAttempts, touchStaffActivity } from "./staffSession";
import { performStaffSwitch } from "./staffSwitchUser";

export type LockPosReason = "manual" | "auto" | "session_expired";

export function lockPos(reason: LockPosReason = "manual"): void {
  const store = usePosStore.getState();
  if (!canLockPos(store.preferences) && !activeStaffCanUnlock(store.preferences.staffAccounts)) {
    return;
  }
  store.setPosLocked(true);
  const actor = store.sessionActor;
  logStaffSessionAudit(reason === "auto" ? "staff_auto_lock" : "staff_lock", {
    staffId: store.preferences.activeStaffId ?? null,
    staffName: actor?.displayName ?? null,
    reason,
    manual: reason === "manual",
    auto: reason === "auto",
  });
}

export type UnlockVerifyResult =
  | { ok: true; staffId: string | null; switched: boolean }
  | { ok: false; errorKey: string; lockedUntil?: string | null; waitSeconds?: number };

export async function verifyLockScreenPin(opts: {
  preferences: ShopPreferences;
  secret: string;
  targetStaffId: string | null;
  selectingOwner: boolean;
  activeStaff: StaffAccount[];
}): Promise<UnlockVerifyResult> {
  const scopeKey = unlockLimiterScope(opts.targetStaffId ?? opts.preferences.activeStaffId);
  const lockout = getUnlockLockoutStatus(scopeKey);
  if (lockout.locked) {
    return {
      ok: false,
      errorKey: "staffUnlockBruteForceLock",
      lockedUntil: lockout.lockedUntil,
      waitSeconds: lockout.waitSeconds,
    };
  }

  const secret = opts.secret.trim();
  const secretPin = normalizePin(secret);
  let staff: StaffAccount | null = opts.selectingOwner
    ? null
    : opts.activeStaff.find((s) => s.id === opts.targetStaffId) ?? null;

  if (!staff && !opts.selectingOwner && !opts.targetStaffId) {
    for (const s of opts.activeStaff) {
      if (await staffSecretMatchesAsync(s, secret)) {
        staff = s;
        break;
      }
    }
  }

  const validStaff = staff ? await staffSecretMatchesAsync(staff, secret) : false;
  const validBackOffice = await verifyShopSecurityPin(secretPin, opts.preferences);
  const canUnlock = validStaff || validBackOffice;

  if (!canUnlock) {
    const maxAttempts = resolveStaffMaxFailedAttempts(opts.preferences);
    const failure = recordUnlockFailure(scopeKey, maxAttempts);
    logStaffSessionAudit("staff_login_failed", {
      staffId: staff?.id ?? opts.targetStaffId ?? opts.preferences.activeStaffId ?? null,
      staffName: staff?.name ?? null,
      source: "lock_screen",
      attempts: failure.failures,
    });
    if (failure.lockedUntil) {
      logStaffSessionAudit("staff_lockout_triggered", {
        staffId: staff?.id ?? opts.targetStaffId ?? opts.preferences.activeStaffId ?? null,
        staffName: staff?.name ?? null,
        source: "lock_screen",
        lockedUntil: failure.lockedUntil,
        waitSeconds: failure.waitSeconds,
        tierIndex: failure.tierIndex,
      });
      return {
        ok: false,
        errorKey: "staffUnlockBruteForceLock",
        lockedUntil: failure.lockedUntil,
        waitSeconds: failure.waitSeconds,
      };
    }
    return { ok: false, errorKey: "enterpriseSecurityWrongPin" };
  }

  clearUnlockFailures(scopeKey);
  const targetStaffId = staff?.id ?? null;
  const switchingStaff = (opts.preferences.activeStaffId ?? null) !== targetStaffId;
  return { ok: true, staffId: targetStaffId, switched: switchingStaff };
}

export function completePosUnlock(staffId: string | null): { ok: true } | { ok: false; errorKey: string } {
  const switchResult = performStaffSwitch(staffId, { fromLockScreen: true });
  if (!switchResult.ok) return switchResult;
  const store = usePosStore.getState();
  store.setPosLocked(false);
  touchStaffActivity();
  logStaffSessionAudit("staff_unlock", {
    staffId: staffId ?? null,
    staffName: store.sessionActor?.displayName ?? null,
    source: "lock_screen",
  });
  return { ok: true };
}

export function emergencyStaffLogout(): void {
  const store = usePosStore.getState();
  const prevId = store.preferences.activeStaffId ?? null;
  const prevStaff = (store.preferences.staffAccounts ?? []).find((s) => s.id === prevId);
  if (prevId) {
    logStaffSessionAudit("staff_logout", {
      staffId: prevId,
      staffName: prevStaff?.name ?? null,
      source: "emergency_logout",
    });
  }
  store.switchStaffAccount(null, { force: true });
  store.setPosLocked(false);
}
