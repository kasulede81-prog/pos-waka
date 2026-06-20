import type { SyncOperation } from "../types";
import { deriveQueueHealth } from "./autoSync";
import { getAuditSyncHealth } from "./auditHealth";
import { readSyncHealthMeta } from "./syncMeta";
import { readSyncQueue } from "../offline/localDb";

export type AuditDeletionGateResult =
  | { ok: true }
  | { ok: false; errorKey: string; reason: string; pendingAuditOps: number };

export function evaluateAuditDeletionGate(
  queue: SyncOperation[],
  syncHealth = readSyncHealthMeta(),
): AuditDeletionGateResult {
  const { pendingAuditOps, ok: auditQueueOk } = getAuditSyncHealth(queue);
  if (!auditQueueOk) {
    return {
      ok: false,
      errorKey: "audit_sync_pending",
      reason: `${pendingAuditOps} audit log(s) waiting to upload`,
      pendingAuditOps,
    };
  }

  const queueHealth = deriveQueueHealth(queue);
  if (queueHealth !== "healthy" || syncHealth.queueHealth !== "healthy") {
    return {
      ok: false,
      errorKey: "sync_health_degraded",
      reason: `Sync queue is ${queueHealth !== "healthy" ? queueHealth : syncHealth.queueHealth}`,
      pendingAuditOps,
    };
  }

  if (syncHealth.lastIssueCode === "error" || syncHealth.lastIssueCode === "partial") {
    return {
      ok: false,
      errorKey: "sync_uploads_pending",
      reason: `Last sync issue: ${syncHealth.lastIssueCode}`,
      pendingAuditOps,
    };
  }

  return { ok: true };
}

export async function canPermanentlyDeleteArchived(): Promise<AuditDeletionGateResult> {
  const queue = await readSyncQueue();
  return evaluateAuditDeletionGate(queue);
}
