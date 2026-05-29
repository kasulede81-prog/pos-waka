import { useMemo } from "react";
import type { ReturnRecord } from "../types";
import { usePosStore } from "../store/usePosStore";

/** Active returns only, or active + archived when the filter is on. */
export function useReportingReturnRecords(includeArchived: boolean): ReturnRecord[] {
  const returnRecords = usePosStore((s) => s.returnRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);
  return useMemo(
    () => (includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords),
    [returnRecords, archivedReturnRecords, includeArchived],
  );
}
