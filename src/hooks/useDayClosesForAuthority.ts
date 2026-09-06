import { useMemo } from "react";
import { dayClosesForAuthority } from "../lib/closedDayAuthority";
import { usePosStore } from "../store/usePosStore";

/** Active + archived DayCloseSummary for existing closed-day authority resolvers. */
export function useDayClosesForAuthority() {
  const dayCloses = usePosStore((s) => s.dayCloses);
  const archivedDayCloses = usePosStore((s) => s.archivedDayCloses);
  return useMemo(
    () => dayClosesForAuthority(dayCloses, archivedDayCloses),
    [dayCloses, archivedDayCloses],
  );
}
