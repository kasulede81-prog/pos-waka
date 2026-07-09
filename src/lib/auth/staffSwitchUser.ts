/**
 * Phase 13.2 — switch-user workflow without app reload.
 */

import { usePosStore } from "../../store/usePosStore";
import { logStaffSessionAudit } from "./staffSessionAudit";
import { touchStaffActivity } from "./staffSession";

export function performStaffSwitch(
  staffId: string | null,
  opts?: { force?: boolean; fromLockScreen?: boolean },
): { ok: true } | { ok: false; errorKey: string } {
  const store = usePosStore.getState();
  const prevId = store.preferences.activeStaffId ?? null;
  const result = store.switchStaffAccount(staffId, { force: opts?.force });
  if (!result.ok) return { ok: false as const, errorKey: result.errorKey ?? "saleError" };

  if (prevId !== staffId && opts?.fromLockScreen) {
    const nextStaff = staffId
      ? (store.preferences.staffAccounts ?? []).find((s) => s.id === staffId)
      : null;
    logStaffSessionAudit("staff_switch_user", {
      fromStaffId: prevId,
      toStaffId: staffId,
      toStaffName: nextStaff?.name ?? (staffId ? staffId : "owner"),
      source: "lock_screen",
    });
  }

  touchStaffActivity();
  return { ok: true };
}

export function prepareSwitchUserLock(): void {
  const store = usePosStore.getState();
  store.setPosLocked(true);
  logStaffSessionAudit("staff_lock", {
    staffId: store.preferences.activeStaffId ?? null,
    staffName: store.sessionActor?.displayName ?? null,
    reason: "switch_user",
    manual: true,
  });
}
