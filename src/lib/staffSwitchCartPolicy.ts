/**
 * Shared-terminal staff switch: do not silently hand the previous operator's
 * unsaved cart / bound pending sale to the next staff member.
 */

export const STAFF_SWITCH_HOLD_LABEL = "staff_switch_hold";

export type StaffSwitchCartPlan = "none" | "detach" | "park_and_detach";

export function isStaffIdentityChange(
  prevStaffId: string | null | undefined,
  nextStaffId: string | null | undefined,
): boolean {
  return (prevStaffId ?? null) !== (nextStaffId ?? null);
}

export function staffSwitchCartPlan(input: {
  prevStaffId: string | null | undefined;
  nextStaffId: string | null | undefined;
  draftLineCount: number;
  activePendingSaleId: string | null | undefined;
  activeTableSessionId?: string | null;
}): StaffSwitchCartPlan {
  if (!isStaffIdentityChange(input.prevStaffId, input.nextStaffId)) return "none";
  if (input.draftLineCount > 0) return "park_and_detach";
  if (input.activePendingSaleId?.trim() || input.activeTableSessionId?.trim()) return "detach";
  return "none";
}
