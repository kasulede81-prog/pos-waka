/**
 * Phase 24.1BB — per-module recovery checkpoints for resume on retry.
 */

import { getActiveAccountKey } from "../offline/accountScope";
import type { CloudRecoveryEntityCounts } from "./cloudRecoverySession";
import type { RecoveryModuleId } from "./recoveryModuleClassification";

export type ModuleCheckpoint = {
  completedAt: string;
  counts: Partial<CloudRecoveryEntityCounts>;
};

export type RecoveryModuleCheckpointState = Partial<Record<RecoveryModuleId, ModuleCheckpoint>>;

const KEY_PREFIX = "waka.recovery.modules.v1:";

function storageKey(): string | null {
  const accountKey = getActiveAccountKey();
  if (!accountKey) return null;
  return `${KEY_PREFIX}${accountKey}`;
}

export function readRecoveryModuleCheckpoints(): RecoveryModuleCheckpointState {
  const key = storageKey();
  if (!key) return {};
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw) as RecoveryModuleCheckpointState;
  } catch {
    return {};
  }
}

export function markRecoveryModuleComplete(
  module: RecoveryModuleId,
  counts?: Partial<CloudRecoveryEntityCounts>,
): void {
  const key = storageKey();
  if (!key) return;
  const prev = readRecoveryModuleCheckpoints();
  prev[module] = { completedAt: new Date().toISOString(), counts: counts ?? {} };
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(prev));
  } catch {
    /* quota */
  }
}

export function clearRecoveryModuleCheckpoints(): void {
  const key = storageKey();
  if (!key) return;
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Skip re-download when module checkpoint matches live store counts. */
export function canSkipRecoveryModule(
  module: RecoveryModuleId,
  live: CloudRecoveryEntityCounts,
): boolean {
  const cp = readRecoveryModuleCheckpoints()[module];
  if (!cp) return false;
  switch (module) {
    case "products":
      return cp.counts.products != null && cp.counts.products === live.products && live.products > 0;
    case "customers":
      return cp.counts.customers != null && cp.counts.customers === live.customers && live.customers > 0;
    case "sales":
      return cp.counts.sales != null && cp.counts.sales === live.sales && live.sales > 0;
    case "inventory":
      return cp.counts.inventory != null && cp.counts.inventory === live.inventory;
    case "staff":
    case "shifts":
      return cp.counts.shifts != null && cp.counts.shifts === live.shifts;
    case "cash":
      return cp.counts.cashRecords != null && cp.counts.cashRecords === live.cashRecords;
    default:
      return false;
  }
}

export function allCriticalModulesCheckpointed(live: CloudRecoveryEntityCounts): boolean {
  return (
    canSkipRecoveryModule("products", live) &&
    canSkipRecoveryModule("customers", live) &&
    live.products > 0
  );
}
