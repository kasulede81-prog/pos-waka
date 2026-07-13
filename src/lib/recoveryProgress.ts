/**
 * Phase 24.2A — monotonic recovery progress (never regress or reset to 0%).
 */

import type { CloudRecoverySessionState, CloudRecoveryStepId } from "./cloudRecoverySession";

/** Download-only steps — validation/finalize excluded from download cap. */
export const CLOUD_RECOVERY_DOWNLOAD_STEP_ORDER: CloudRecoveryStepId[] = [
  "probing",
  "snapshot",
  "products",
  "sales",
  "customers",
  "returns",
  "inventory",
  "shifts",
  "day_closes",
  "cash",
  "staff",
];

export const DOWNLOAD_PROGRESS_CAP = 90;
export const VALIDATING_PROGRESS = 95;
export const FINALIZING_PROGRESS = 98;

/** Map legacy/optional steps to nearest ladder index (never -1). */
const STEP_INDEX_FALLBACK: Partial<Record<CloudRecoveryStepId, number>> = {
  snapshot_empty_after_restore: 1,
  audit: 10,
  validation: 10,
};

export function downloadStepIndex(step: CloudRecoveryStepId | null): number {
  if (!step) return -1;
  const idx = CLOUD_RECOVERY_DOWNLOAD_STEP_ORDER.indexOf(step);
  if (idx >= 0) return idx;
  const fallback = STEP_INDEX_FALLBACK[step];
  return fallback ?? CLOUD_RECOVERY_DOWNLOAD_STEP_ORDER.length - 1;
}

export function progressPctForStep(step: CloudRecoveryStepId | null): number {
  const idx = downloadStepIndex(step);
  if (idx < 0) return 0;
  const total = CLOUD_RECOVERY_DOWNLOAD_STEP_ORDER.length;
  return Math.min(DOWNLOAD_PROGRESS_CAP, Math.round(((idx + 1) / total) * DOWNLOAD_PROGRESS_CAP));
}

export function computeRecoveryProgressPct(session: CloudRecoverySessionState): number {
  if (session.status === "complete") return 100;
  if (session.progressPhase === "complete") return 100;
  if (session.progressPhase === "finalizing") return Math.max(session.progressFloorPct, FINALIZING_PROGRESS);
  if (session.progressPhase === "validating") return Math.max(session.progressFloorPct, VALIDATING_PROGRESS);

  const fromStep = progressPctForStep(session.lastCompletedStep);
  const floor = session.progressFloorPct ?? 0;
  const manual = session.manualProgressPct ?? 0;
  return Math.min(DOWNLOAD_PROGRESS_CAP, Math.max(fromStep, floor, manual));
}

export function isRecoveryProgressComplete(session: CloudRecoverySessionState): boolean {
  return session.status === "complete" || session.progressPhase === "complete";
}

/** Snapshot persist band: 18% (post-snapshot) → 40% while writing IndexedDB. */
export function snapshotPersistProgressPct(innerPct: number): number {
  const start = progressPctForStep("snapshot");
  const end = progressPctForStep("products");
  return Math.round(start + (innerPct / 100) * (end - start));
}
