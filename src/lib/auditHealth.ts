import type { AuditLogEntry, Language, SyncOperation } from "../types";
import { t } from "./i18n";

export const AUDIT_RETENTION_WARN_COUNT = 4000;
export const AUDIT_RETENTION_MAX_COUNT = 5000;

export type AuditRetentionStatus = {
  count: number;
  warn: boolean;
  atCap: boolean;
};

export function getAuditRetentionStatus(auditLogs: AuditLogEntry[]): AuditRetentionStatus {
  const count = auditLogs.length;
  return {
    count,
    warn: count >= AUDIT_RETENTION_WARN_COUNT,
    atCap: count >= AUDIT_RETENTION_MAX_COUNT,
  };
}

export type AuditSyncHealth = {
  pendingAuditOps: number;
  ok: boolean;
};

export function getAuditSyncHealth(queue: SyncOperation[]): AuditSyncHealth {
  const pendingAuditOps = queue.filter((op) => op.kind === "audit_log").length;
  return { pendingAuditOps, ok: pendingAuditOps === 0 };
}

export function buildAuditExportText(auditLogs: AuditLogEntry[], lang: Language): string {
  const sorted = [...auditLogs].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const lines: string[] = [
    `WAKA POS — ${t(lang, "auditExportHeading")}`,
    `${t(lang, "auditExportGenerated")}: ${new Date().toISOString()}`,
    `${t(lang, "auditExportCount")}: ${sorted.length}`,
    "",
  ];
  for (const e of sorted) {
    lines.push(
      `${e.at} | ${e.action} | ${e.actorName ?? e.actorUserId} | ${e.payloadSummary}`,
    );
  }
  return lines.join("\n");
}
