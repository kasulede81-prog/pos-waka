import type { DayDrawerOpen, ShiftRecord } from "../types";
import { activeDayDrawerOpenForDate } from "./dayDrawerOpen";
import { dateKeyKampala } from "./datesUg";

export type DayDrawerOpenDiagnosticsSnapshot = {
  activeOpen: DayDrawerOpen | null;
  duplicateOpenCount: number;
  unsyncedCount: number;
  conflictingDeviceCount: number;
  verificationMismatchCount: number;
};

export function collectDayDrawerOpenDiagnostics(
  dayDrawerOpens: DayDrawerOpen[],
  shifts: ShiftRecord[],
  todayKey: string,
): DayDrawerOpenDiagnosticsSnapshot {
  const activeRows = dayDrawerOpens.filter(
    (r) => !r.deletedAt && r.dateKey === todayKey && r.status === "open",
  );
  const activeOpen = activeDayDrawerOpenForDate(dayDrawerOpens, todayKey);
  const duplicateOpenCount = Math.max(0, activeRows.length - 1);

  const unsyncedCount = dayDrawerOpens.filter((r) => !r.deletedAt && r.pendingSync).length;

  const deviceIds = new Set(activeRows.map((r) => r.deviceId).filter(Boolean));
  const conflictingDeviceCount = deviceIds.size > 1 ? deviceIds.size : 0;

  const todayShifts = shifts.filter((s) => dateKeyKampala(s.startAt) === todayKey);
  let verificationMismatchCount = 0;
  for (const sh of todayShifts) {
    if (sh.verifiedFloatUgx == null || sh.segmentBaselineUgx == null) continue;
    if (sh.verificationVarianceUgx != null && sh.verificationVarianceUgx !== 0) {
      verificationMismatchCount += 1;
      continue;
    }
    if (sh.verifiedFloatUgx !== sh.segmentBaselineUgx && sh.verificationStatus !== "mismatch_overridden") {
      verificationMismatchCount += 1;
    }
  }

  return {
    activeOpen,
    duplicateOpenCount,
    unsyncedCount,
    conflictingDeviceCount,
    verificationMismatchCount,
  };
}
