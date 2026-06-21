import { readSyncCheckpoints } from "./syncCheckpoints";
import { readSyncHealthMeta } from "./syncMeta";
import { getAuditSyncHealth } from "./auditHealth";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";
import { classifyInventoryIntegrityStatus } from "./recoveryInventoryReconciliation";
import { getRecentInventoryConflicts } from "./inventoryConflictLog";
import { getCloudRecoverySession } from "./cloudRecoverySession";
import { readSyncQueue } from "../offline/localDb";
import { deriveQueueHealth } from "./autoSync";
import { nextQueueRetryMs as queueRetryFromEngine } from "../offline/syncEngine";
import { readLastEntityPullErrors } from "./pullDiagnostics";
import { usePosStore } from "../store/usePosStore";
import type { SyncOperation } from "../types";

export type SyncHealthDashboardSnapshot = {
  queueSize: number;
  oldestPendingAt: string | null;
  failedOperations: number;
  retryWaitMs: number | null;
  queueHealth: "healthy" | "degraded" | "backing_off";
  inventoryIntegrityOk: boolean;
  inventoryIntegrityStatus: "healthy" | "warning" | "critical";
  inventoryMismatchCount: number;
  inventoryMismatches: import("./inventoryIntegrity").InventoryIntegrityMismatch[];
  inventoryConflictCount: number;
  auditPendingOps: number;
  auditSyncOk: boolean;
  recoveryStatus: string | null;
  bootstrapComplete: boolean;
  lastSuccessfulPull: string | null;
  lastSuccessfulPush: string | null;
  lastSyncAttempt: string | null;
  lastIssueCode: "none" | "partial" | "error";
  entityPullErrors: Record<string, string>;
  posPushAttempts: number;
  posPushSuccesses: number;
  posPushFailures: number;
  lastPosPushAt: string | null;
};

function oldestPendingCreatedAt(queue: SyncOperation[]): string | null {
  if (queue.length === 0) return null;
  let oldest: string | null = null;
  for (const op of queue) {
    if (!oldest || op.createdAt < oldest) oldest = op.createdAt;
  }
  return oldest;
}

function countFailedOperations(queue: SyncOperation[]): number {
  return queue.filter((op) => op.attempts > 0).length;
}

export async function buildSyncHealthDashboardSnapshot(): Promise<SyncHealthDashboardSnapshot> {
  const queue = await readSyncQueue();
  const health = readSyncHealthMeta();
  const checkpoints = readSyncCheckpoints();
  const auditHealth = getAuditSyncHealth(queue);
  const state = usePosStore.getState();
  const integrity = verifyInventoryIntegrity({
    products: state.products,
    movements: state.stockMovements,
  });
  const inventoryIntegrityStatus = classifyInventoryIntegrityStatus(integrity.mismatches);
  const recovery = getCloudRecoverySession();

  return {
    queueSize: queue.length,
    oldestPendingAt: oldestPendingCreatedAt(queue),
    failedOperations: countFailedOperations(queue),
    retryWaitMs: queueRetryFromEngine(queue),
    queueHealth: deriveQueueHealth(queue),
    inventoryIntegrityOk: integrity.ok,
    inventoryIntegrityStatus,
    inventoryMismatchCount: integrity.mismatches.length,
    inventoryMismatches: integrity.mismatches,
    inventoryConflictCount: getRecentInventoryConflicts().length,
    auditPendingOps: auditHealth.pendingAuditOps,
    auditSyncOk: auditHealth.ok,
    recoveryStatus: recovery.status === "idle" ? null : recovery.status,
    bootstrapComplete: checkpoints.bootstrapComplete,
    lastSuccessfulPull: health.lastPullAt,
    lastSuccessfulPush: health.lastPushAt ?? health.lastSuccessAt,
    lastSyncAttempt: health.lastAttemptAt,
    lastIssueCode: health.lastIssueCode,
    entityPullErrors: readLastEntityPullErrors(),
    posPushAttempts: health.posPushAttempts ?? 0,
    posPushSuccesses: health.posPushSuccesses ?? 0,
    posPushFailures: health.posPushFailures ?? 0,
    lastPosPushAt: health.lastPosPushAt ?? null,
  };
}
