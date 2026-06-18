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
  latestClosedShiftForDay,
  normalizeDayDrawerOpen,
  shiftVerificationBaselineUgx,
} from "../lib/dayDrawerOpen";
import { hasPermission } from "../lib/permissions";
import { resolveFloatVerifyOverride } from "../lib/managerFloatVerify";
import { shiftExpectedCash, type ShiftCashContext } from "../lib/saleAdjustments";
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
    void queueRemote("pending_day_drawer_opens", { dayOpenId: row.id });
    return { ok: true as const, dayOpenId: row.id };
  };

  const supersedeDayDrawerOpen = (input: {
    previousId: string;
    openingFloatUgx: number;
    note?: string;
    reason?: string;
  }) => {
    const denied = denyUnlessEffectivePermission("day.open_drawer", "supersedeDayDrawerOpen");
    if (denied) return { ok: false as const, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false as const, errorKey: "noSelection" };

    const prev = state.dayDrawerOpens.find((r) => r.id === input.previousId && r.status === "open");
    if (!prev) return { ok: false as const, errorKey: "invalid" };
    if (!isDayDrawerOpenMutable(state.sales, prev.dateKey)) {
      return { ok: false as const, errorKey: "dayDrawerLockedAfterSales" };
    }

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
    });
    void queueRemote("pending_day_drawer_opens", { dayOpenId: row.id });
    return { ok: true as const, dayOpenId: row.id };
  };

  const voidDayDrawerOpen = (input: { dayOpenId: string; reason: string }) => {
    const denied = denyUnlessEffectivePermission("day.open_drawer", "voidDayDrawerOpen");
    if (denied) return { ok: false as const, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false as const, errorKey: "noSelection" };

    const row = state.dayDrawerOpens.find((r) => r.id === input.dayOpenId && r.status === "open");
    if (!row) return { ok: false as const, errorKey: "invalid" };
    if (!isDayDrawerOpenMutable(state.sales, row.dateKey)) {
      return { ok: false as const, errorKey: "dayDrawerLockedAfterSales" };
    }

    const reason = input.reason.trim();
    if (reason.length < 3) return { ok: false as const, errorKey: "invalid" };

    patchDayDrawerOpen(set, row.id, { status: "voided", voidReason: reason });
    pushAudit("day_drawer_open_void", `Void day open ${row.dateKey}`, {
      dayOpenId: row.id,
      dateKey: row.dateKey,
      voidReason: reason,
      actorUserId: actor.userId,
    });
    void queueRemote("pending_day_drawer_opens", { dayOpenId: row.id, void: true });
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
      if (!override.ok || !hasPermission(override.role, "day.verify_opening_float")) {
        return { ok: false as const, errorKey: "auth_forbidden" };
      }

      verifiedByUserId = override.actorUserId;
      verifiedByLabel = override.actorLabel;
      verificationStatus = priorShift ? "handoff_overridden" : "mismatch_overridden";

      if (input.overrideAction === "correct_day_open") {
        if (!isDayDrawerOpenMutable(state.sales, todayKey)) {
          return { ok: false as const, errorKey: "dayDrawerLockedAfterSales" };
        }
        const sup = supersedeDayDrawerOpen({
          previousId: dayOpen.id,
          openingFloatUgx: verified,
          reason: input.overrideReason,
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
      dayDrawerOpenId: dayOpenId,
      priorShiftId,
      handoffFloatUgx: null,
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
    return { ok: true as const, shiftId: row.id };
  };

  const closeShiftWithHandoff = (input: { countedCashUgx: number; handoffFloatUgx: number }) => {
    const denied = denyUnlessEffectivePermission("shift.close", "closeShiftWithCashCount");
    if (denied) return { ok: false as const, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false as const, errorKey: "noSelection" };

    const open = (state.preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId);
    if (!open) return { ok: false as const, errorKey: "invalid" };

    const formulaVersion = isFormulaV2(state.preferences) ? "v2" : "v1";
    const ctx: ShiftCashContext = { formulaVersion };
    const expected = shiftExpectedCash(open, ctx);
    const counted = Math.max(0, Math.floor(input.countedCashUgx));
    const handoff = Math.max(0, Math.floor(input.handoffFloatUgx));
    const differenceUgx = counted - expected;
    const endAt = new Date().toISOString();

    set((st) => ({
      preferences: {
        ...st.preferences,
        shifts: (st.preferences.shifts ?? []).map((sh) =>
          sh.id === open.id
            ? {
                ...sh,
                endAt,
                countedCashUgx: counted,
                cashDifferenceUgx: differenceUgx,
                handoffFloatUgx: formulaVersion === "v2" ? handoff : sh.handoffFloatUgx,
              }
            : sh,
        ),
      },
    }));

    pushAudit("shift_close_count", `Shift close · expected UGX ${expected.toLocaleString()} · counted UGX ${counted.toLocaleString()}`, {
      shiftId: open.id,
      expectedCashUgx: expected,
      countedCashUgx: counted,
      differenceUgx,
      actorUserId: actor.userId,
    });
    if (formulaVersion === "v2") {
      pushAudit("shift_handoff_ready", `Handoff UGX ${handoff.toLocaleString()}`, {
        shiftId: open.id,
        handoffFloatUgx: handoff,
        actorUserId: actor.userId,
      });
    }
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
