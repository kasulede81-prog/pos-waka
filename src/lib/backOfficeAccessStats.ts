import type { AuditLogEntry } from "../types";
import { dateKeyKampala } from "./datesUg";

export type BackOfficeAccessStats = {
  lastUnlockAt: string | null;
  lastUnlockRole: string | null;
  lastUnlockActor: string | null;
  failedAttemptsToday: number;
  ownerUnlocksToday: number;
  managerUnlocksToday: number;
};

function isUnlockSuccess(action: string): boolean {
  return action === "back_office_unlock_success" || action === "back_office_unlock";
}

function isUnlockFailed(action: string): boolean {
  return action === "back_office_unlock_failed";
}

export function computeBackOfficeAccessStats(auditLogs: AuditLogEntry[], todayKey?: string): BackOfficeAccessStats {
  const today = todayKey ?? dateKeyKampala(new Date());
  let lastUnlockAt: string | null = null;
  let lastUnlockRole: string | null = null;
  let lastUnlockActor: string | null = null;
  let failedAttemptsToday = 0;
  let ownerUnlocksToday = 0;
  let managerUnlocksToday = 0;

  for (const e of auditLogs) {
    const day = dateKeyKampala(e.at);
    if (isUnlockFailed(e.action) && day === today) {
      failedAttemptsToday += 1;
    }
    if (isUnlockSuccess(e.action)) {
      if (!lastUnlockAt || e.at > lastUnlockAt) {
        lastUnlockAt = e.at;
        lastUnlockRole = typeof e.payload.unlockRole === "string" ? e.payload.unlockRole : e.role;
        lastUnlockActor =
          e.actorName?.trim() ||
          (typeof e.payload.unlockLabel === "string" ? e.payload.unlockLabel : e.actorUserId);
      }
      if (day === today) {
        const unlockRole = typeof e.payload.unlockRole === "string" ? e.payload.unlockRole : e.role;
        if (unlockRole === "owner") ownerUnlocksToday += 1;
        if (unlockRole === "manager") managerUnlocksToday += 1;
      }
    }
  }

  return {
    lastUnlockAt,
    lastUnlockRole,
    lastUnlockActor,
    failedAttemptsToday,
    ownerUnlocksToday,
    managerUnlocksToday,
  };
}
