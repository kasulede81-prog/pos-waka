import { activeSessions } from "./hospitalityStats";
import { shiftExpectedCash, type ShiftCashContext } from "./saleAdjustments";
import type { Permission, ShiftRecord, ShopPreferences, UserRole } from "../types";

export type ShiftCloseOptions = {
  shiftId?: string;
  recoveryReason?: string;
  recoveryNotes?: string;
};

export type ShiftCloseAuth = {
  actorUserId: string;
  actorRole: UserRole;
  actorDisplayName?: string;
  hasPermission: (permission: Permission) => boolean;
};

export function listOpenShifts(shifts: ShiftRecord[] | undefined): ShiftRecord[] {
  return (shifts ?? []).filter((sh) => !sh.endAt);
}

export function resolveShiftCloseTarget(
  shifts: ShiftRecord[] | undefined,
  actorUserId: string,
  shiftId?: string,
): { ok: true; shift: ShiftRecord; isRecovery: boolean } | { ok: false; errorKey: string } {
  if (shiftId) {
    const target = (shifts ?? []).find((sh) => sh.id === shiftId && !sh.endAt);
    if (!target) return { ok: false, errorKey: "invalid" };
    return { ok: true, shift: target, isRecovery: target.actorUserId !== actorUserId };
  }

  const own = (shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actorUserId);
  if (own) return { ok: true, shift: own, isRecovery: false };

  const anyOpen = listOpenShifts(shifts);
  if (anyOpen.length > 0) {
    return { ok: false, errorKey: "shiftCloseOtherOperator" };
  }
  return { ok: false, errorKey: "invalid" };
}

export function authorizeShiftClose(
  auth: ShiftCloseAuth,
  shift: ShiftRecord,
  isRecovery: boolean,
): { ok: true } | { ok: false; errorKey: string } {
  if (!isRecovery) {
    if (!auth.hasPermission("shift.close")) return { ok: false, errorKey: "auth_forbidden" };
    return { ok: true };
  }

  if (auth.actorRole === "owner") return { ok: true };
  if (
    (auth.actorRole === "manager" || auth.actorRole === "supervisor") &&
    auth.hasPermission("day.close")
  ) {
    return { ok: true };
  }
  if (shift.actorUserId === auth.actorUserId && auth.hasPermission("shift.close")) {
    return { ok: true };
  }
  return { ok: false, errorKey: "shiftRecoverDenied" };
}

/** Recovery close skips the current actor's draft cart — only shop-wide hospitality blocks apply. */
export function assertCanRecoverShift(state: {
  preferences: Pick<ShopPreferences, "hospitalityFloor">;
}): { ok: true } | { ok: false; errorKey: string } {
  const floor = state.preferences.hospitalityFloor;
  if (floor && activeSessions(floor).length > 0) {
    return { ok: false, errorKey: "shiftCloseOpenTable" };
  }
  return { ok: true };
}

export function buildShiftClosePatch(
  open: ShiftRecord,
  input: {
    counted: number;
    handoff?: number;
    endAt: string;
    differenceUgx: number;
    formulaVersion: "v1" | "v2";
  },
  recovery?: {
    recoveredByUserId: string;
    recoveredByLabel: string;
    recoveredAt: string;
    recoveryReason?: string;
    recoveryNotes?: string;
  },
): ShiftRecord {
  return {
    ...open,
    endAt: input.endAt,
    countedCashUgx: input.counted,
    cashDifferenceUgx: input.differenceUgx,
    handoffFloatUgx: input.formulaVersion === "v2" ? (input.handoff ?? input.counted) : open.handoffFloatUgx,
    pendingSync: true,
    updatedAt: input.endAt,
    ...(recovery
      ? {
          recoveredByUserId: recovery.recoveredByUserId,
          recoveredByLabel: recovery.recoveredByLabel,
          recoveredAt: recovery.recoveredAt,
          recoveryReason: recovery.recoveryReason?.trim() || null,
          recoveryNotes: recovery.recoveryNotes?.trim() || null,
        }
      : {}),
  };
}

export function computeShiftCloseAmounts(
  open: ShiftRecord,
  countedCashUgx: number,
  handoffFloatUgx: number | undefined,
  ctx: ShiftCashContext,
): { counted: number; handoff: number; expected: number; differenceUgx: number } {
  const expected = shiftExpectedCash(open, ctx);
  const counted = Math.max(0, Math.floor(countedCashUgx));
  const handoff = Math.max(0, Math.floor(handoffFloatUgx ?? counted));
  return {
    counted,
    handoff,
    expected,
    differenceUgx: counted - expected,
  };
}

export function logShiftRecoveryEvent(event: string, detail?: Record<string, unknown>): void {
  if (detail && Object.keys(detail).length > 0) {
    console.info(`[waka-shift] ${event}`, detail);
    return;
  }
  console.info(`[waka-shift] ${event}`);
}

export function canActorRecoverShifts(auth: ShiftCloseAuth): boolean {
  if (auth.actorRole === "owner") return true;
  return (
    (auth.actorRole === "manager" || auth.actorRole === "supervisor") && auth.hasPermission("day.close")
  );
}

export function listRecoverableOpenShifts(
  shifts: ShiftRecord[] | undefined,
  actorUserId: string,
): ShiftRecord[] {
  return listOpenShifts(shifts).filter((sh) => sh.actorUserId !== actorUserId);
}
