/**
 * Day drawer open + shift verification store mutations.
 */

import type { DayDrawerOpen, ShiftRecord } from "../types";
import { dateKeyKampala } from "../lib/datesUg";
import { getOrCreateDeviceId } from "../lib/deviceId";
import {
  activeDayDrawerOpenForDate,
  floatVerificationWithinTolerance,
  isDayDrawerOpenMutable,
  isFormulaV2,
  isOwnerDayOpenCorrectionAfterSalesEnabled,
  latestClosedShiftForDay,
  normalizeDayDrawerOpen,
  shiftVerificationBaselineUgx,
  verifyOwnerDayOpenCorrection,
} from "../lib/dayDrawerOpen";
import { hasActorPermission } from "../lib/permissions";
import { resolveStaffPermissions } from "../lib/enterpriseRoles";
import { assertSequentialBusinessDay } from "../lib/sequentialBusinessDays";
import { assertBusinessDateNotLocked } from "../lib/businessDateLock";
import { resolveFloatVerifyOverride } from "../lib/managerFloatVerify";
import { type ShiftCashContext } from "../lib/saleAdjustments";
import { assertCanCloseShift } from "../lib/shiftEnforcement";
import {
  assertCanRecoverShift,
  authorizeShiftClose,
  buildShiftClosePatch,
  computeShiftCloseAmounts,
  logShiftRecoveryEvent,
  resolveShiftCloseTarget,
} from "../lib/shiftRecoveryOps";
import type { PosState } from "./usePosStore";

type StoreGet = () => PosState;
type StoreSet = (partial: Partial<PosState> | ((s: PosState) => Partial<PosState>)) => void;

type Deps = {
  get: StoreGet;
  set: StoreSet;
  pushAudit: (
    action: import("../types").AuditAction,
    summary: string,
    payload: Record<string, unknown>,
  ) => void;
  queueRemote: (kind: import("../types").SyncOperationKind, payload: unknown) => void;
  denyUnlessEffectivePermission: (
    permission: import("../types").Permission,
    label: string,
  ) => { ok: false; errorKey: string } | null;
};

export type BeginShiftV2Input = {
  verifiedFloatUgx: number;
  /** Manager override path — requires PIN + day.verify_opening_float */
  managerPin?: string;
  overrideAction?: "accept_cashier" | "correct_day_open" | "reject";
  overrideReason?: string;
};

function patchDayDrawerOpen(set: StoreSet, id: string, patch: Partial<DayDrawerOpen>): void {
  const now = new Date().toISOString();
  set((s) => ({
    dayDrawerOpens: s.dayDrawerOpens.map((row) =>
      row.id === id
        ? normalizeDayDrawerOpen({ ...row, ...patch, updatedAt: now, pendingSync: true })
        : row,
    ),
  }));
}

type DayOpenEditGateInput = {
  dateKey: string;
  reason: string;
  ownerOverridePin?: string;
};

function assertDayDrawerOpenEditable(
  state: PosState,
  input: DayOpenEditGateInput,
): { ok: true; afterSalesCorrection: boolean; correctionAuth?: import("../lib/dayDrawerOpen").OwnerDayOpenCorrectionAuth } | { ok: false; errorKey: string } {
  if (isDayDrawerOpenMutable(state.sales, input.dateKey)) {
    return { ok: true, afterSalesCorrection: false };
  }
  if (!isOwnerDayOpenCorrectionAfterSalesEnabled(state.preferences)) {
    return { ok: false, errorKey: "dayDrawerLockedAfterSales" };
  }
  const actor = state.sessionActor;
  if (!actor) return { ok: false, errorKey: "noSelection" };
  const verified = verifyOwnerDayOpenCorrection({
    pin: input.ownerOverridePin ?? "",
    reason: input.reason,
    preferences: state.preferences,
    sessionRole: actor.role,
    sessionUserId: actor.userId,
    sessionLabel: actor.displayName ?? actor.userId,
  });
  if (!verified.ok) return verified;
  return { ok: true, afterSalesCorrection: true, correctionAuth: verified.auth };
}

export function createDayDrawerOpenStoreActions(deps: Deps) {
  const { get, set, pushAudit, queueRemote, denyUnlessEffectivePermission } = deps;

  const recordDayDrawerOpen = (input: {
    openingFloatUgx: number;
    note?: string;
    witnessUserId?: string | null;
    dateKey?: string;
  }) => {
    const denied = denyUnlessEffectivePermission("day.open_drawer", "recordDayDrawerOpen");
    if (denied) return { ok: false as const, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false as const, errorKey: "noSelection" };

    const dateKey = input.dateKey?.trim() || dateKeyKampala(new Date());
    const amount = Math.floor(input.openingFloatUgx);
    if (amount <= 0) return { ok: false as const, errorKey: "invalidMoney" };

    const seq = assertSequentialBusinessDay({
      targetDateKey: dateKey,
      dayCloses: state.dayCloses,
      sales: state.sales,
      shifts: state.preferences.shifts ?? [],
      dayDrawerOpens: state.dayDrawerOpens,
    });
    if (!seq.ok) return { ok: false as const, errorKey: seq.errorKey, unclosedDays: seq.unclosedDays };

    const dayLock = assertBusinessDateNotLocked(state.dayCloses, dateKey);
    if (!dayLock.ok) return { ok: false as const, errorKey: dayLock.errorKey };

    const existing = activeDayDrawerOpenForDate(state.dayDrawerOpens, dateKey);
    if (existing) return { ok: false as const, errorKey: "dayDrawerAlreadyOpen" };

    const now = new Date().toISOString();
    const row = normalizeDayDrawerOpen({
      id: crypto.randomUUID(),
      dateKey,
      openingFloatUgx: amount,
      countedAt: now,
      countedByUserId: actor.userId,
      countedByLabel: actor.displayName ?? actor.userId,
      firstVerifiedByUserId: null,
      firstVerifiedByLabel: null,
      note: (input.note ?? "").trim(),
      witnessUserId: input.witnessUserId ?? null,
      deviceId: getOrCreateDeviceId(),
      status: "open",
      supersedesId: null,
      voidReason: null,
      createdAt: now,
      updatedAt: now,
      pendingSync: true,
      lastSyncError: null,
      deletedAt: null,
    });

    set((s) => ({ dayDrawerOpens: [row, ...s.dayDrawerOpens] }));
    pushAudit("day_drawer_open", `Day open ${dateKey} UGX ${amount.toLocaleString()}`, {
      dayOpenId: row.id,
      dateKey,
      openingFloatUgx: amount,
      actorUserId: actor.userId,
      actorName: actor.displayName,
      deviceId: row.deviceId,
      note: row.note,
    });
    void queueRemote("pending_day_drawer_opens", { action: "create", dayOpenId: row.id });
    return { ok: true as const, dayOpenId: row.id };
  };

  const supersedeDayDrawerOpen = (input: {
    previousId: string;
    openingFloatUgx: number;
    note?: string;
    reason?: string;
    ownerOverridePin?: string;
  }) => {
    const denied = denyUnlessEffectivePermission("day.open_drawer", "supersedeDayDrawerOpen");
    if (denied) return { ok: false as const, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false as const, errorKey: "noSelection" };

    const prev = state.dayDrawerOpens.find((r) => r.id === input.previousId && r.status === "open");
    if (!prev) return { ok: false as const, errorKey: "invalid" };
    const editGate = assertDayDrawerOpenEditable(state, {
      dateKey: prev.dateKey,
      reason: (input.reason ?? input.note ?? "").trim(),
      ownerOverridePin: input.ownerOverridePin,
    });
    if (!editGate.ok) return { ok: false as const, errorKey: editGate.errorKey };

    const amount = Math.floor(input.openingFloatUgx);
    if (amount <= 0) return { ok: false as const, errorKey: "invalidMoney" };

    const now = new Date().toISOString();
    const row = normalizeDayDrawerOpen({
      id: crypto.randomUUID(),
      dateKey: prev.dateKey,
      openingFloatUgx: amount,
      countedAt: now,
      countedByUserId: actor.userId,
      countedByLabel: actor.displayName ?? actor.userId,
      firstVerifiedByUserId: prev.firstVerifiedByUserId,
      firstVerifiedByLabel: prev.firstVerifiedByLabel,
      note: (input.note ?? prev.note).trim(),
      witnessUserId: prev.witnessUserId ?? null,
      deviceId: getOrCreateDeviceId(),
      status: "open",
      supersedesId: prev.id,
      voidReason: null,
      createdAt: now,
      updatedAt: now,
      pendingSync: true,
      lastSyncError: null,
      deletedAt: null,
    });

    set((s) => ({
      dayDrawerOpens: [
        row,
        ...s.dayDrawerOpens.map((r) =>
          r.id === prev.id ? normalizeDayDrawerOpen({ ...r, status: "superseded", updatedAt: now, pendingSync: true }) : r,
        ),
      ],
    }));
    pushAudit("day_drawer_open_supersede", `Supersede day open ${prev.dateKey}`, {
      previousId: prev.id,
      newId: row.id,
      dateKey: prev.dateKey,
      oldAmount: prev.openingFloatUgx,
      newAmount: amount,
      reason: (input.reason ?? "").trim(),
      actorUserId: actor.userId,
      afterSalesCorrection: editGate.afterSalesCorrection,
      ...(editGate.correctionAuth
        ? {
            ownerOverrideByUserId: editGate.correctionAuth.managerUserId,
            ownerOverrideByLabel: editGate.correctionAuth.managerLabel,
            ownerOverrideReason: editGate.correctionAuth.reason,
          }
        : {}),
    });
    void queueRemote("pending_day_drawer_opens", {
      action: "supersede",
      dayOpenId: row.id,
      previousId: prev.id,
    });
    return { ok: true as const, dayOpenId: row.id };
  };

  const voidDayDrawerOpen = (input: { dayOpenId: string; reason: string; ownerOverridePin?: string }) => {
    const denied = denyUnlessEffectivePermission("day.open_drawer", "voidDayDrawerOpen");
    if (denied) return { ok: false as const, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false as const, errorKey: "noSelection" };

    const row = state.dayDrawerOpens.find((r) => r.id === input.dayOpenId && r.status === "open");
    if (!row) return { ok: false as const, errorKey: "invalid" };
    const editGate = assertDayDrawerOpenEditable(state, {
      dateKey: row.dateKey,
      reason: input.reason,
      ownerOverridePin: input.ownerOverridePin,
    });
    if (!editGate.ok) return { ok: false as const, errorKey: editGate.errorKey };

    const reason = input.reason.trim();
    if (reason.length < 3) return { ok: false as const, errorKey: "invalid" };

    patchDayDrawerOpen(set, row.id, { status: "voided", voidReason: reason });
    pushAudit("day_drawer_open_void", `Void day open ${row.dateKey}`, {
      dayOpenId: row.id,
      dateKey: row.dateKey,
      voidReason: reason,
      actorUserId: actor.userId,
      afterSalesCorrection: editGate.afterSalesCorrection,
      ...(editGate.correctionAuth
        ? {
            ownerOverrideByUserId: editGate.correctionAuth.managerUserId,
            ownerOverrideByLabel: editGate.correctionAuth.managerLabel,
            ownerOverrideReason: editGate.correctionAuth.reason,
          }
        : {}),
    });
    void queueRemote("pending_day_drawer_opens", { action: "void", dayOpenId: row.id });
    return { ok: true as const };
  };

  const beginShiftV2 = (input: BeginShiftV2Input) => {
    const denied = denyUnlessEffectivePermission("shift.start", "beginShift");
    if (denied) return { ok: false as const, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false as const, errorKey: "noSelection" };

    const open = (state.preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId);
    if (open) return { ok: false as const, errorKey: "invalid" };

    const todayKey = dateKeyKampala(new Date());
    const dayOpen = activeDayDrawerOpenForDate(state.dayDrawerOpens, todayKey);
    if (!dayOpen) return { ok: false as const, errorKey: "dayDrawerNotOpen" };

    const shifts = state.preferences.shifts ?? [];
    const priorShift = latestClosedShiftForDay(shifts, todayKey);
    const baseline = shiftVerificationBaselineUgx(todayKey, shifts, dayOpen, priorShift);
    const verified = Math.max(0, Math.floor(input.verifiedFloatUgx));
    const matched = floatVerificationWithinTolerance(baseline, verified, state.preferences);

    let verificationStatus: ShiftRecord["verificationStatus"] = priorShift
      ? "handoff_matched"
      : "matched";
    let verifiedByUserId = actor.userId;
    let verifiedByLabel = actor.displayName ?? actor.userId;
    let segmentBaseline = baseline;
    let dayOpenId = dayOpen.id;
    let priorShiftId = priorShift?.id ?? null;

    if (!matched) {
      pushAudit("shift_float_mismatch", `Shift float mismatch baseline ${baseline} vs ${verified}`, {
        baselineUgx: baseline,
        verifiedFloatUgx: verified,
        actorUserId: actor.userId,
        dayOpenId: dayOpen.id,
        priorShiftId,
      });

      if (input.overrideAction === "reject" || !input.managerPin) {
        return { ok: false as const, errorKey: "shiftFloatMismatch" };
      }

      const override = resolveFloatVerifyOverride(
        input.managerPin,
        state.preferences,
        actor.role,
        actor.userId,
        actor.displayName ?? actor.userId,
      );
      const overrideStaff = override.ok && override.staffId
        ? state.preferences.staffAccounts?.find((s) => s.id === override.staffId)
        : undefined;
      const overridePerms = overrideStaff
        ? resolveStaffPermissions(overrideStaff, state.preferences.customStaffRoles)
        : undefined;
      if (!override.ok || !hasActorPermission(override.role, "day.verify_opening_float", overridePerms)) {
        return { ok: false as const, errorKey: "auth_forbidden" };
      }

      verifiedByUserId = override.actorUserId;
      verifiedByLabel = override.actorLabel;
      verificationStatus = priorShift ? "handoff_overridden" : "mismatch_overridden";

      if (input.overrideAction === "correct_day_open") {
        const locked = !isDayDrawerOpenMutable(state.sales, todayKey);
        if (locked) {
          if (!isOwnerDayOpenCorrectionAfterSalesEnabled(state.preferences)) {
            return { ok: false as const, errorKey: "dayDrawerLockedAfterSales" };
          }
          if (override.role !== "owner") {
            return { ok: false as const, errorKey: "dayOpenOverrideOwnerOnly" };
          }
          const reason = (input.overrideReason ?? "").trim();
          if (reason.length < 3) {
            return { ok: false as const, errorKey: "dayOpenOverrideReasonRequired" };
          }
        }
        const sup = supersedeDayDrawerOpen({
          previousId: dayOpen.id,
          openingFloatUgx: verified,
          reason: input.overrideReason,
          ownerOverridePin: locked ? input.managerPin : undefined,
        });
        if (!sup.ok) return sup;
        dayOpenId = sup.dayOpenId;
        segmentBaseline = verified;
      } else if (input.overrideAction === "accept_cashier") {
        segmentBaseline = verified;
      } else {
        return { ok: false as const, errorKey: "shiftFloatMismatch" };
      }

      pushAudit("shift_float_override", `Manager override shift float`, {
        action: input.overrideAction,
        baselineUgx: baseline,
        verifiedFloatUgx: verified,
        managerUserId: override.actorUserId,
        managerLabel: override.actorLabel,
        reason: input.overrideReason ?? "",
        dayOpenId,
      });
    } else {
      pushAudit(
        priorShift ? "shift_handoff_verified" : "shift_float_verified",
        `Verified ${verified.toLocaleString()} UGX`,
        {
          verifiedFloatUgx: verified,
          baselineUgx: baseline,
          actorUserId: actor.userId,
          dayOpenId,
          priorShiftId,
        },
      );
    }

    const now = new Date().toISOString();
    const row: ShiftRecord = {
      id: crypto.randomUUID(),
      actorUserId: actor.userId,
      actorName: actor.displayName,
      role: actor.role,
      startAt: now,
      endAt: null,
      salesTotalUgx: 0,
      debtTotalUgx: 0,
      refundsUgx: 0,
      estimatedCashUgx: 0,
      discountsTotalUgx: 0,
      voidsTotalUgx: 0,
      returnsTotalUgx: 0,
      debtPaymentsTotalUgx: 0,
      countedCashUgx: null,
      cashDifferenceUgx: null,
      openingFloatUgx: null,
      verifiedFloatUgx: verified,
      segmentBaselineUgx: segmentBaseline,
      verificationStatus,
      verifiedAt: now,
      verifiedByUserId,
      verifiedByLabel,
      verificationVarianceUgx: verified - baseline,
      dayDrawerOpenId: dayOpenId,
      priorShiftId,
      handoffFloatUgx: null,
      pendingSync: true,
      updatedAt: now,
    };

    if (!dayOpen.firstVerifiedByUserId) {
      patchDayDrawerOpen(set, dayOpenId, {
        firstVerifiedByUserId: actor.userId,
        firstVerifiedByLabel: actor.displayName ?? actor.userId,
      });
    }

    set((st) => ({
      preferences: {
        ...st.preferences,
        shifts: [row, ...(st.preferences.shifts ?? [])],
      },
    }));
    pushAudit("shift_start", `Shift start ${actor.displayName ?? actor.userId}`, {
      shiftId: row.id,
      actorUserId: actor.userId,
      verifiedFloatUgx: verified,
      segmentBaselineUgx: segmentBaseline,
      dayOpenId,
    });
    void queueRemote("pending_shifts", { shiftId: row.id });
    return { ok: true as const, shiftId: row.id };
  };

  const closeShiftWithHandoff = (input: {
    countedCashUgx: number;
    handoffFloatUgx: number;
    shiftId?: string;
    recoveryReason?: string;
    recoveryNotes?: string;
  }) => {
    const denied = denyUnlessEffectivePermission("shift.close", "closeShiftWithCashCount");
    if (denied) return { ok: false as const, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false as const, errorKey: "noSelection" };

    const target = resolveShiftCloseTarget(state.preferences.shifts, actor.userId, input.shiftId);
    if (!target.ok) return { ok: false as const, errorKey: target.errorKey };

    const hasPermission = (permission: import("../types").Permission) =>
      denyUnlessEffectivePermission(permission, "closeShiftWithCashCount") === null;
    const authz = authorizeShiftClose(
      {
        actorUserId: actor.userId,
        actorRole: actor.role,
        actorDisplayName: actor.displayName,
        hasPermission,
      },
      target.shift,
      target.isRecovery,
    );
    if (!authz.ok) return { ok: false as const, errorKey: authz.errorKey };

    const closeGuard = target.isRecovery ? assertCanRecoverShift(state) : assertCanCloseShift(state);
    if (!closeGuard.ok) return { ok: false as const, errorKey: closeGuard.errorKey };

    const formulaVersion = isFormulaV2(state.preferences) ? "v2" : "v1";
    const ctx: ShiftCashContext = { formulaVersion };
    const { counted, handoff, expected, differenceUgx } = computeShiftCloseAmounts(
      target.shift,
      input.countedCashUgx,
      input.handoffFloatUgx,
      ctx,
    );
    const endAt = new Date().toISOString();
    const recoveryMeta = target.isRecovery
      ? {
          recoveredByUserId: actor.userId,
          recoveredByLabel: actor.displayName ?? actor.userId,
          recoveredAt: endAt,
          recoveryReason: input.recoveryReason,
          recoveryNotes: input.recoveryNotes,
        }
      : undefined;

    set((st) => ({
      preferences: {
        ...st.preferences,
        shifts: (st.preferences.shifts ?? []).map((sh) =>
          sh.id === target.shift.id
            ? buildShiftClosePatch(
                sh,
                { counted, handoff, endAt, differenceUgx, formulaVersion },
                recoveryMeta,
              )
            : sh,
        ),
      },
    }));

    pushAudit(
      target.isRecovery ? "shift_recovery_close" : "shift_close_count",
      target.isRecovery
        ? `Shift recovery close · ${target.shift.actorName ?? target.shift.actorUserId} · expected UGX ${expected.toLocaleString()} · counted UGX ${counted.toLocaleString()}`
        : `Shift close · expected UGX ${expected.toLocaleString()} · counted UGX ${counted.toLocaleString()}`,
      {
        shiftId: target.shift.id,
        expectedCashUgx: expected,
        countedCashUgx: counted,
        differenceUgx,
        actorUserId: target.shift.actorUserId,
        operatorUserId: target.shift.actorUserId,
        operatorLabel: target.shift.actorName ?? target.shift.actorUserId,
        ...(target.isRecovery
          ? {
              recoveredByUserId: actor.userId,
              recoveredByLabel: actor.displayName ?? actor.userId,
              recoveryReason: input.recoveryReason?.trim() || null,
              recoveryNotes: input.recoveryNotes?.trim() || null,
            }
          : { closedByUserId: actor.userId }),
      },
    );
    if (formulaVersion === "v2") {
      pushAudit("shift_handoff_ready", `Handoff UGX ${handoff.toLocaleString()}`, {
        shiftId: target.shift.id,
        handoffFloatUgx: handoff,
        actorUserId: target.shift.actorUserId,
        ...(target.isRecovery
          ? { recoveredByUserId: actor.userId, recoveredByLabel: actor.displayName ?? actor.userId }
          : {}),
      });
    }
    if (target.isRecovery) {
      logShiftRecoveryEvent("recovering_shift", {
        shiftId: target.shift.id,
        operatorUserId: target.shift.actorUserId,
        recoveredByUserId: actor.userId,
        varianceUgx: differenceUgx,
      });
    }
    void queueRemote("pending_shifts", { shiftId: target.shift.id });
    return { ok: true as const, differenceUgx };
  };

  return {
    recordDayDrawerOpen,
    supersedeDayDrawerOpen,
    voidDayDrawerOpen,
    beginShiftV2,
    closeShiftWithHandoff,
  };
}
