/**
 * IC-P2-03 — active audit working-set cap with overflow into archivedAuditLogs.
 * Date-based archive (partitionForArchive) stays the age policy. This is capacity only.
 */
import type { AuditLogEntry } from "../types";
import { AUDIT_RETENTION_MAX_COUNT } from "./auditHealth";

export function sortAuditLogsNewestFirst(entries: AuditLogEntry[]): AuditLogEntry[] {
  return [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Incoming last-write wins. Used by local push/hydrate merges. */
export function mergeAuditLogEntriesById(
  existing: AuditLogEntry[],
  incoming: AuditLogEntry[],
): AuditLogEntry[] {
  const byId = new Map<string, AuditLogEntry>();
  for (const e of existing) {
    if (e.id) byId.set(e.id, e);
  }
  for (const e of incoming) {
    if (e.id) byId.set(e.id, e);
  }
  return [...byId.values()];
}

function mergeArchivedById(existing: AuditLogEntry[], incoming: AuditLogEntry[]): AuditLogEntry[] {
  const byId = new Map<string, AuditLogEntry>();
  for (const e of existing) {
    if (e.id) byId.set(e.id, e);
  }
  for (const e of incoming) {
    if (!e.id || byId.has(e.id)) continue;
    byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * Keep the newest `maxActive` candidates in auditLogs.
 * Overflow is merged into archivedAuditLogs by id (no duplicates).
 * An id is never left in both buckets; remaining active wins if they collide.
 */
export function applyAuditActiveCap(
  activeCandidates: AuditLogEntry[],
  existingArchived: AuditLogEntry[] = [],
  maxActive: number = AUDIT_RETENTION_MAX_COUNT,
): { auditLogs: AuditLogEntry[]; archivedAuditLogs: AuditLogEntry[] } {
  const seen = new Set<string>();
  const sorted: AuditLogEntry[] = [];
  for (const e of sortAuditLogsNewestFirst(activeCandidates.filter((e) => Boolean(e.id)))) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    sorted.push(e);
  }
  const auditLogs = sorted.slice(0, maxActive);
  const overflow = sorted.slice(maxActive);
  const activeIds = new Set(auditLogs.map((e) => e.id));
  const archivedKeep = existingArchived.filter((e) => e.id && !activeIds.has(e.id));
  return {
    auditLogs,
    archivedAuditLogs: mergeArchivedById(archivedKeep, overflow),
  };
}
