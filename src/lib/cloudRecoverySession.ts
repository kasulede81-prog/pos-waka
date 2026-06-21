/**
 * Cloud recovery session — P0 recovery lock state, progress, and diagnostics.
 */

import type { CloudRecoveryValidationResult } from "./cloudRecoveryValidator";
import type { RecoveryCompletenessReport } from "./cloudRecoveryCompleteness";

export type CloudRecoveryStepId =
  | "probing"
  | "snapshot"
  | "snapshot_empty_after_restore"
  | "products"
  | "sales"
  | "customers"
  | "returns"
  | "inventory"
  | "shifts"
  | "day_closes"
  | "cash"
  | "staff"
  | "audit"
  | "validation";

export type CloudRecoveryEntityCounts = {
  products: number;
  sales: number;
  customers: number;
  inventory: number;
  shifts: number;
  dayCloses: number;
  cashRecords: number;
};

export type RecoveryIntegrityDiagnostics = {
  snapshotRowFound: boolean;
  snapshotContainsCoreData: boolean;
  snapshotRestoreAttempted: boolean;
  snapshotRestoreProducedData: boolean;
  fullPullAttempted: boolean;
  fullPullDownloadedCounts: CloudRecoveryEntityCounts;
  finalStoreCounts: CloudRecoveryEntityCounts;
  recoveryInvariantPassed: boolean;
  lastDiagnosticEvent: string | null;
};

export type CloudRecoverySessionState = {
  status: "idle" | "active" | "failed" | "complete";
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  currentStep: CloudRecoveryStepId | null;
  lastCompletedStep: CloudRecoveryStepId | null;
  /** Rows downloaded from cloud during pull (may lead restored counts). */
  downloadedCounts: CloudRecoveryEntityCounts;
  /** Rows confirmed in local store after restore + persist. */
  restoredCounts: CloudRecoveryEntityCounts;
  /** @deprecated Prefer restoredCounts — kept for persisted diagnostics compatibility. */
  entityCounts: CloudRecoveryEntityCounts;
  integrityDiagnostics: RecoveryIntegrityDiagnostics;
  certification: import("./cloudTrustCenter").CloudTrustCertificationReport | null;
  errorMessage: string | null;
  errorKey: string | null;
  validation: CloudRecoveryValidationResult | null;
  completeness: RecoveryCompletenessReport | null;
};

export type CloudRecoveryDiagnostics = CloudRecoverySessionState & {
  lastRecoveryAt: string | null;
};

const DIAGNOSTICS_KEY = "waka.cloudRecovery.diagnostics.v1";

const emptyCounts = (): CloudRecoveryEntityCounts => ({
  products: 0,
  sales: 0,
  customers: 0,
  inventory: 0,
  shifts: 0,
  dayCloses: 0,
  cashRecords: 0,
});

const emptyIntegrityDiagnostics = (): RecoveryIntegrityDiagnostics => ({
  snapshotRowFound: false,
  snapshotContainsCoreData: false,
  snapshotRestoreAttempted: false,
  snapshotRestoreProducedData: false,
  fullPullAttempted: false,
  fullPullDownloadedCounts: emptyCounts(),
  finalStoreCounts: emptyCounts(),
  recoveryInvariantPassed: false,
  lastDiagnosticEvent: null,
});

let session: CloudRecoverySessionState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  currentStep: null,
  lastCompletedStep: null,
  downloadedCounts: emptyCounts(),
  restoredCounts: emptyCounts(),
  entityCounts: emptyCounts(),
  integrityDiagnostics: emptyIntegrityDiagnostics(),
  certification: null,
  errorMessage: null,
  errorKey: null,
  validation: null,
  completeness: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function cloneSession(): CloudRecoverySessionState {
  return {
    ...session,
    downloadedCounts: { ...session.downloadedCounts },
    restoredCounts: { ...session.restoredCounts },
    entityCounts: { ...session.restoredCounts },
    integrityDiagnostics: {
      ...session.integrityDiagnostics,
      fullPullDownloadedCounts: { ...session.integrityDiagnostics.fullPullDownloadedCounts },
      finalStoreCounts: { ...session.integrityDiagnostics.finalStoreCounts },
    },
  };
}

function persistDiagnostics(): void {
  try {
    const payload: CloudRecoveryDiagnostics = {
      ...cloneSession(),
      lastRecoveryAt: session.finishedAt ?? session.startedAt,
    };
    localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

export function subscribeCloudRecovery(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCloudRecoverySession(): CloudRecoverySessionState {
  return cloneSession();
}

export function readLastCloudRecoveryDiagnostics(): CloudRecoveryDiagnostics | null {
  try {
    const raw = localStorage.getItem(DIAGNOSTICS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CloudRecoveryDiagnostics;
    if (!parsed.restoredCounts && parsed.entityCounts) {
      parsed.restoredCounts = { ...parsed.entityCounts };
      parsed.downloadedCounts = parsed.downloadedCounts ?? { ...parsed.entityCounts };
    }
    if (!parsed.integrityDiagnostics) {
      parsed.integrityDiagnostics = emptyIntegrityDiagnostics();
    }
    return parsed;
  } catch {
    return null;
  }
}

/** True while recovery is running or failed — blocks POS and mutations. */
export function isCloudRecoveryLockActive(): boolean {
  return session.status === "active" || session.status === "failed";
}

export function beginCloudRecoverySession(): void {
  session = {
    status: "active",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    currentStep: null,
    lastCompletedStep: null,
    downloadedCounts: emptyCounts(),
    restoredCounts: emptyCounts(),
    entityCounts: emptyCounts(),
    integrityDiagnostics: emptyIntegrityDiagnostics(),
    certification: null,
    errorMessage: null,
    errorKey: null,
    validation: null,
    completeness: null,
  };
  emit();
}

export function recordRecoveryIntegrityDiagnostics(
  patch: Partial<RecoveryIntegrityDiagnostics>,
): void {
  session.integrityDiagnostics = { ...session.integrityDiagnostics, ...patch };
  emit();
}

export function recordRecoveryCertification(
  report: import("./cloudTrustCenter").CloudTrustCertificationReport,
): void {
  session.certification = report;
  emit();
}

export function getRecoveryCertification(): import("./cloudTrustCenter").CloudTrustCertificationReport | null {
  return session.certification ? { ...session.certification, rows: [...session.certification.rows] } : null;
}

export function logRecoveryDiagnosticEvent(event: string): void {
  session.integrityDiagnostics = {
    ...session.integrityDiagnostics,
    lastDiagnosticEvent: event,
  };
  emit();
}

export function reportRecoveryStep(
  step: CloudRecoveryStepId,
  counts?: Partial<CloudRecoveryEntityCounts>,
): void {
  if (session.status !== "active") return;
  session.currentStep = step;
  session.lastCompletedStep = step;
  if (counts) {
    session.downloadedCounts = { ...session.downloadedCounts, ...counts };
  }
  emit();
}

/** Update restored counts from the live store after merge + persist succeed. */
export function syncRecoveryRestoredCountsFromStore(counts: CloudRecoveryEntityCounts): void {
  session.restoredCounts = { ...counts };
  session.entityCounts = { ...counts };
  emit();
}

/** @deprecated Use syncRecoveryRestoredCountsFromStore */
export function updateRecoveryEntityCounts(counts: Partial<CloudRecoveryEntityCounts>): void {
  session.restoredCounts = { ...session.restoredCounts, ...counts };
  session.entityCounts = { ...session.restoredCounts };
  emit();
}

export function completeCloudRecoverySession(
  validation: CloudRecoveryValidationResult,
  completeness: RecoveryCompletenessReport | null = null,
): void {
  const finishedAt = new Date().toISOString();
  const startedMs = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  session = {
    ...session,
    status: "complete",
    finishedAt,
    durationMs: Date.now() - startedMs,
    currentStep: "validation",
    lastCompletedStep: "validation",
    validation,
    errorMessage: null,
    errorKey: null,
    completeness,
    entityCounts: { ...session.restoredCounts },
    certification: session.certification,
  };
  persistDiagnostics();
  emit();
}

export function failCloudRecoverySession(
  errorMessage: string,
  validation: CloudRecoveryValidationResult | null = null,
  errorKey: string | null = null,
): void {
  const finishedAt = new Date().toISOString();
  const startedMs = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  session = {
    ...session,
    status: "failed",
    finishedAt,
    durationMs: Date.now() - startedMs,
    errorMessage,
    errorKey,
    validation,
    completeness: null,
    entityCounts: { ...session.restoredCounts },
    certification: session.certification,
  };
  persistDiagnostics();
  emit();
}

export function resetCloudRecoverySessionForRetry(): void {
  session = {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    currentStep: null,
    lastCompletedStep: null,
    downloadedCounts: emptyCounts(),
    restoredCounts: emptyCounts(),
    entityCounts: emptyCounts(),
    integrityDiagnostics: emptyIntegrityDiagnostics(),
    certification: null,
    errorMessage: null,
    errorKey: null,
    validation: null,
    completeness: null,
  };
  emit();
}

export const CLOUD_RECOVERY_STEP_ORDER: CloudRecoveryStepId[] = [
  "probing",
  "snapshot",
  "products",
  "sales",
  "customers",
  "inventory",
  "shifts",
  "day_closes",
  "cash",
  "validation",
];
