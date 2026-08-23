import { activeSessions } from "./hospitalityStats";
import type { ShiftRecord, ShopPreferences } from "../types";
import type { SessionActor } from "./sessionActor";
import { shiftOwnerUserId } from "./sessionActor";

export function getActiveShiftForActor(
  shifts: ShiftRecord[] | undefined,
  actorUserId: string,
): ShiftRecord | null {
  return (shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actorUserId) ?? null;
}

export type ActiveShiftGuardResult =
  | { ok: true; shift: ShiftRecord }
  | { ok: false; errorKey: "noActiveShift" | "noSelection" };

/** Store-level guard — UI checks alone are insufficient. */
export function requireActiveShift(state: {
  sessionActor: Pick<SessionActor, "userId" | "authUserId"> | null;
  preferences: Pick<ShopPreferences, "shifts">;
}): ActiveShiftGuardResult {
  const actor = state.sessionActor;
  if (!actor) return { ok: false, errorKey: "noSelection" };
  const ownerId = shiftOwnerUserId(actor);
  if (!ownerId) return { ok: false, errorKey: "noSelection" };
  const shift = getActiveShiftForActor(state.preferences.shifts, ownerId);
  if (!shift) return { ok: false, errorKey: "noActiveShift" };
  return { ok: true, shift };
}

/**
 * Re-key orphaned `staff:<id>` open shifts to the authenticated writer (client-only).
 * No sale rewrite; no cloud schema change.
 */
export function rekeySharedTerminalOpenShifts(
  shifts: ShiftRecord[] | undefined,
  writerUserId: string | null | undefined,
): ShiftRecord[] | undefined {
  const writer = writerUserId?.trim() ?? "";
  if (!writer || writer.startsWith("staff:")) return shifts;
  const list = shifts ?? [];
  let changed = false;
  const next = list.map((sh) => {
    if (sh.endAt || !sh.actorUserId.startsWith("staff:")) return sh;
    changed = true;
    return {
      ...sh,
      actorUserId: writer,
      pendingSync: true,
      updatedAt: new Date().toISOString(),
    };
  });
  return changed ? next : shifts;
}

export type ShiftCloseBlockState = {
  draftLines: { length: number };
  activePendingSaleId: string | null;
  sales: { id: string; status?: string }[];
  preferences: Pick<ShopPreferences, "hospitalityFloor">;
};

export function assertCanCloseShift(state: ShiftCloseBlockState): { ok: true } | { ok: false; errorKey: string } {
  if (state.draftLines.length > 0) {
    return { ok: false, errorKey: "shiftCloseDraftSaleOpen" };
  }
  if (state.activePendingSaleId) {
    const pending = state.sales.find((s) => s.id === state.activePendingSaleId && s.status === "pending");
    if (pending) return { ok: false, errorKey: "shiftClosePendingSale" };
  }
  const floor = state.preferences.hospitalityFloor;
  if (floor && activeSessions(floor).length > 0) {
    return { ok: false, errorKey: "shiftCloseOpenTable" };
  }
  return { ok: true };
}

export function formatShiftDuration(startAt: string, nowMs = Date.now()): string {
  const ms = Math.max(0, nowMs - new Date(startAt).getTime());
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function shiftStatusLabel(shift: ShiftRecord): "ACTIVE" | "CLOSED" {
  return shift.endAt ? "CLOSED" : "ACTIVE";
}
