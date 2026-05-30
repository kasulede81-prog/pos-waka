import { useEffect, useMemo } from "react";
import type { AuditLogEntry, Sale } from "../types";
import { usePosStore, ensureAllActiveSalesLoaded } from "../store/usePosStore";
import { auditLogsForReporting, salesForReporting } from "../lib/recordArchive";

/** Active sales only, or active + archived when the filter is on. */
export function useReportingSales(includeArchived: boolean): Sale[] {
  const sales = usePosStore((s) => s.sales);
  const archivedSales = usePosStore((s) => s.archivedSales);

  useEffect(() => {
    void ensureAllActiveSalesLoaded();
  }, []);

  return useMemo(() => salesForReporting({ sales, archivedSales }, includeArchived), [sales, archivedSales, includeArchived]);
}

export function useReportingAuditLogs(includeArchived: boolean): AuditLogEntry[] {
  const auditLogs = usePosStore((s) => s.auditLogs);
  const archivedAuditLogs = usePosStore((s) => s.archivedAuditLogs);
  return useMemo(
    () => auditLogsForReporting({ auditLogs, archivedAuditLogs }, includeArchived),
    [auditLogs, archivedAuditLogs, includeArchived],
  );
}
