import { useEffect, useMemo, useState } from "react";
import {
  boundsRequiresArchivedSales,
  DEFAULT_DATE_FILTER,
  resolveDateFilterBounds,
  type DateFilterBounds,
  type DateFilterValue,
} from "../lib/dateFilters";
import { usePosStore } from "../store/usePosStore";

export function useReportingDateFilter(initial: DateFilterValue = DEFAULT_DATE_FILTER) {
  const [filter, setFilter] = useState<DateFilterValue>(initial);
  const [includeArchived, setIncludeArchived] = useState(false);
  const archivedSalesCount = usePosStore((s) => s.archivedSales.length);

  const bounds: DateFilterBounds = useMemo(() => resolveDateFilterBounds(filter), [filter]);
  const needsArchive = useMemo(() => boundsRequiresArchivedSales(bounds), [bounds]);
  const archiveNotice = needsArchive && !includeArchived;

  useEffect(() => {
    if (needsArchive && !includeArchived) {
      setIncludeArchived(true);
    }
  }, [needsArchive, includeArchived]);

  return {
    filter,
    setFilter,
    bounds,
    includeArchived,
    setIncludeArchived,
    needsArchive,
    archiveNotice,
    archivedSalesCount,
  };
}
