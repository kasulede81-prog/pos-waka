import { useDeferredValue } from "react";
import type { AuditLogEntry } from "../types";
import { useReportingAuditLogs } from "./useReportingSales";

/** Merged audit logs, deferred when archive filter toggles. */
export function useDeferredReportingAuditLogs(includeArchived: boolean): AuditLogEntry[] {
  const merged = useReportingAuditLogs(includeArchived);
  return useDeferredValue(merged);
}
