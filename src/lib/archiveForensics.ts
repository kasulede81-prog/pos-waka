import type { AuditLogEntry, ReturnRecord, Sale, VoidRecord } from "../types";

export type ArchiveForensicSummary = {
  salesCount: number;
  returnsCount: number;
  voidCount: number;
  auditCount: number;
  archiveAgeDays: number | null;
  oldestArchivedAt: string | null;
  generatedAt: string;
};

function oldestIso(dates: string[]): string | null {
  if (!dates.length) return null;
  return dates.reduce((a, b) => (a < b ? a : b));
}

export function buildArchiveForensicSummary(input: {
  archivedSales: Sale[];
  archivedReturnRecords: ReturnRecord[];
  archivedVoidRecords: VoidRecord[];
  archivedAuditLogs: AuditLogEntry[];
  lastArchiveRunAt?: string | null;
  now?: Date;
}): ArchiveForensicSummary {
  const now = input.now ?? new Date();
  const saleDates = input.archivedSales.map((s) => s.createdAt);
  const returnDates = input.archivedReturnRecords.map((r) => r.createdAt);
  const voidDates = input.archivedVoidRecords.map((v) => v.createdAt);
  const auditDates = input.archivedAuditLogs.map((a) => a.at);
  const oldestArchivedAt = oldestIso([...saleDates, ...returnDates, ...voidDates, ...auditDates]);

  let archiveAgeDays: number | null = null;
  const anchor = oldestArchivedAt ?? input.lastArchiveRunAt ?? null;
  if (anchor) {
    const ms = now.getTime() - new Date(anchor).getTime();
    archiveAgeDays = Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
  }

  return {
    salesCount: input.archivedSales.length,
    returnsCount: input.archivedReturnRecords.length,
    voidCount: input.archivedVoidRecords.length,
    auditCount: input.archivedAuditLogs.length,
    archiveAgeDays,
    oldestArchivedAt,
    generatedAt: now.toISOString(),
  };
}
