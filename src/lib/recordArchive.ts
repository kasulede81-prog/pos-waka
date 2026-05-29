import type {
  AuditLogEntry,
  DayCloseSummary,
  ReturnRecord,
  Sale,
  ShiftRecord,
  VoidRecord,
} from "../types";
import { archiveCutoffIso, isBeforeCutoff } from "./dataRetention";
import type { DataRetentionPolicy } from "../types";

export type ArchiveMoveResult = {
  sales: Sale[];
  archivedSales: Sale[];
  auditLogs: AuditLogEntry[];
  archivedAuditLogs: AuditLogEntry[];
  dayCloses: DayCloseSummary[];
  archivedDayCloses: DayCloseSummary[];
  voidRecords: VoidRecord[];
  archivedVoidRecords: VoidRecord[];
  returnRecords: ReturnRecord[];
  archivedReturnRecords: ReturnRecord[];
  shifts: ShiftRecord[];
  archivedShifts: ShiftRecord[];
  moved: {
    sales: number;
    auditLogs: number;
    dayCloses: number;
    voidRecords: number;
    returnRecords: number;
    shifts: number;
  };
};

export type ArchiveBuckets = {
  sales: Sale[];
  archivedSales: Sale[];
  auditLogs: AuditLogEntry[];
  archivedAuditLogs: AuditLogEntry[];
  dayCloses: DayCloseSummary[];
  archivedDayCloses: DayCloseSummary[];
  voidRecords: VoidRecord[];
  archivedVoidRecords: VoidRecord[];
  returnRecords: ReturnRecord[];
  archivedReturnRecords: ReturnRecord[];
  shifts: ShiftRecord[];
  archivedShifts: ShiftRecord[];
};

/** Merge active + archived when owner enables “include archived” in reports. */
export function salesForReporting(buckets: Pick<ArchiveBuckets, "sales" | "archivedSales">, includeArchived: boolean): Sale[] {
  if (!includeArchived || buckets.archivedSales.length === 0) return buckets.sales;
  return [...buckets.sales, ...buckets.archivedSales];
}

export function auditLogsForReporting(
  buckets: Pick<ArchiveBuckets, "auditLogs" | "archivedAuditLogs">,
  includeArchived: boolean,
): AuditLogEntry[] {
  if (!includeArchived || buckets.archivedAuditLogs.length === 0) return buckets.auditLogs;
  return [...buckets.auditLogs, ...buckets.archivedAuditLogs].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/**
 * Move eligible rows into archive buckets (never deletes).
 * Pending-sync sales are kept active so cloud upload can finish.
 */
export function partitionForArchive(
  policy: DataRetentionPolicy,
  input: ArchiveBuckets,
  nowMs = Date.now(),
): ArchiveMoveResult {
  const cutoff = archiveCutoffIso(policy, nowMs);
  if (!cutoff) {
    return {
      ...input,
      moved: { sales: 0, auditLogs: 0, dayCloses: 0, voidRecords: 0, returnRecords: 0, shifts: 0 },
    };
  }

  const toArchiveSales: Sale[] = [];
  const keepSales: Sale[] = [];
  for (const s of input.sales) {
    if (s.pendingSync || !isBeforeCutoff(s.createdAt, cutoff)) keepSales.push(s);
    else toArchiveSales.push(s);
  }

  const archivedSaleIds = new Set(toArchiveSales.map((s) => s.id));

  const toArchiveAudit: AuditLogEntry[] = [];
  const keepAudit: AuditLogEntry[] = [];
  for (const e of input.auditLogs) {
    if (isBeforeCutoff(e.at, cutoff)) toArchiveAudit.push(e);
    else keepAudit.push(e);
  }

  const toArchiveCloses: DayCloseSummary[] = [];
  const keepCloses: DayCloseSummary[] = [];
  for (const d of input.dayCloses) {
    if (isBeforeCutoff(d.createdAt, cutoff)) toArchiveCloses.push(d);
    else keepCloses.push(d);
  }

  const toArchiveVoid: VoidRecord[] = [];
  const keepVoid: VoidRecord[] = [];
  for (const v of input.voidRecords) {
    if (archivedSaleIds.has(v.saleId) || isBeforeCutoff(v.createdAt, cutoff)) toArchiveVoid.push(v);
    else keepVoid.push(v);
  }

  const toArchiveReturn: ReturnRecord[] = [];
  const keepReturn: ReturnRecord[] = [];
  for (const r of input.returnRecords) {
    if ((r.saleId && archivedSaleIds.has(r.saleId)) || isBeforeCutoff(r.createdAt, cutoff)) toArchiveReturn.push(r);
    else keepReturn.push(r);
  }

  const toArchiveShifts: ShiftRecord[] = [];
  const keepShifts: ShiftRecord[] = [];
  for (const sh of input.shifts) {
    const end = sh.endAt ?? sh.startAt;
    if (sh.endAt && isBeforeCutoff(end, cutoff)) toArchiveShifts.push(sh);
    else keepShifts.push(sh);
  }

  return {
    sales: keepSales,
    archivedSales: [...toArchiveSales, ...input.archivedSales],
    auditLogs: keepAudit,
    archivedAuditLogs: [...toArchiveAudit, ...input.archivedAuditLogs],
    dayCloses: keepCloses,
    archivedDayCloses: [...toArchiveCloses, ...input.archivedDayCloses],
    voidRecords: keepVoid,
    archivedVoidRecords: [...toArchiveVoid, ...input.archivedVoidRecords],
    returnRecords: keepReturn,
    archivedReturnRecords: [...toArchiveReturn, ...input.archivedReturnRecords],
    shifts: keepShifts,
    archivedShifts: [...toArchiveShifts, ...input.archivedShifts],
    moved: {
      sales: toArchiveSales.length,
      auditLogs: toArchiveAudit.length,
      dayCloses: toArchiveCloses.length,
      voidRecords: toArchiveVoid.length,
      returnRecords: toArchiveReturn.length,
      shifts: toArchiveShifts.length,
    },
  };
}

export function emptyArchiveBuckets(): ArchiveBuckets {
  return {
    sales: [],
    archivedSales: [],
    auditLogs: [],
    archivedAuditLogs: [],
    dayCloses: [],
    archivedDayCloses: [],
    voidRecords: [],
    archivedVoidRecords: [],
    returnRecords: [],
    archivedReturnRecords: [],
    shifts: [],
    archivedShifts: [],
  };
}
