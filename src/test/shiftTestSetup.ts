import { usePosStore } from "../store/usePosStore";
import type { ShiftRecord } from "../types";

/** Injects an active v1 shift without store side-effects (no IndexedDB / sync queue). */
export function openTestShift(openingFloatUgx = 10_000): { ok: boolean } {
  const state = usePosStore.getState();
  const actor = state.sessionActor;
  if (!actor) return { ok: false };

  const row: ShiftRecord = {
    id: "test-shift-1",
    actorUserId: actor.userId,
    actorName: actor.displayName,
    role: actor.role,
    startAt: "2026-06-11T08:00:00.000Z",
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
    openingFloatUgx: openingFloatUgx > 0 ? openingFloatUgx : null,
    verificationStatus: "legacy_unverified",
    pendingSync: false,
    updatedAt: "2026-06-11T08:00:00.000Z",
  };

  usePosStore.setState({
    preferences: {
      ...state.preferences,
      cashDrawerFormulaVersion: "v1",
      shifts: [row, ...(state.preferences.shifts ?? []).filter((s) => s.actorUserId !== actor.userId || s.endAt)],
    },
  });
  return { ok: true };
}
