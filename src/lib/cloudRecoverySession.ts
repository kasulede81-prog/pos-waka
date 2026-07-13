/**
 * Cloud recovery session — P0 recovery lock state, progress, and diagnostics.
 */

import type { CloudRecoveryValidationResult } from "./cloudRecoveryValidator";
import type { RecoveryCompletenessReport } from "./cloudRecoveryCompleteness";
import { progressPctForStep, DOWNLOAD_PROGRESS_CAP } from "./recoveryProgress";

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

export type RecoveryInventoryReconciliationDiagnostics = {
  productsRestored: number;
  movementsRestored: number;
  syntheticMovementsGenerated: number;
  remainingMismatchCount: number;
  inventoryIntegrityStatus: import("./recoveryInventoryReconciliation").InventoryIntegrityStatus;
  mismatches: import("./inventoryIntegrity").InventoryIntegrityMismatch[];
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
  inventoryReconciliation: RecoveryInventoryReconciliationDiagnostics | null;
};

export type RecoveryRuntimeDiagnostics = {
  sessionId: string | null;
  currentStage: string | null;
  stageStartedAt: string | null;
  timeoutCount: number;
  retryCount: number;
  idbPersistDurationMs: number | null;
  lastCloudRequestDurationMs: number | null;
};

export type CloudRecoverySessionState = {
  status: "idle" | "active" | "core_unlocked" | "certifying" | "failed" | "complete";
  progressPhase: "downloading" | "validating" | "finalizing" | "complete";
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  currentStep: CloudRecoveryStepId | null;
  lastCompletedStep: CloudRecoveryStepId | null;
  /** Monotonic floor — progress never drops below this during download. */
  progressFloorPct: number;
  /** Explicit sub-step progress (e.g. snapshot persist). */
  manualProgressPct: number;
  runtime: RecoveryRuntimeDiagnostics;
  /** Rows downloaded from cloud during pull (may lead restored counts). */
  downloadedCounts: CloudRecoveryEntityCounts;
  /** Rows confirmed in local store after restore + persist. */
  restoredCounts: CloudRecoveryEntityCounts;
  /** @deprecated Prefer restoredCounts — kept for persisted diagnostics compatibility. */
  entityCounts: CloudRecoveryEntityCounts;
  integrityDiagnostics: RecoveryIntegrityDiagnostics;
  certification: import("./cloudTrustCenter").CloudTrustCertificationReport | null;
  certificationWarnings: string[];
  errorMessage: string | null;
  errorKey: string | null;
  validation: CloudRecoveryValidationResult | null;
  completeness: RecoveryCompletenessReport | null;
  completedWithInventoryWarnings: boolean;
  completionMessage: string | null;
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
  inventoryReconciliation: null,
});

const emptyRuntime = (): RecoveryRuntimeDiagnostics => ({
  sessionId: null,
  currentStage: null,
  stageStartedAt: null,
  timeoutCount: 0,
  retryCount: 0,
  idbPersistDurationMs: null,
  lastCloudRequestDurationMs: null,
});

let session: CloudRecoverySessionState = {
  status: "idle",
  progressPhase: "downloading",
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  currentStep: null,
  lastCompletedStep: null,
  progressFloorPct: 0,
  manualProgressPct: 0,
  runtime: emptyRuntime(),
  downloadedCounts: emptyCounts(),
  restoredCounts: emptyCounts(),
  entityCounts: emptyCounts(),
  integrityDiagnostics: emptyIntegrityDiagnostics(),
  certification: null,
  certificationWarnings: [],
  errorMessage: null,
  errorKey: null,
  validation: null,
  completeness: null,
  completedWithInventoryWarnings: false,
  completionMessage: null,
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
    runtime: { ...session.runtime },
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
    if (!parsed.progressPhase) {
      parsed.progressPhase = parsed.status === "complete" ? "complete" : "downloading";
    }
    if (typeof parsed.progressFloorPct !== "number") {
      parsed.progressFloorPct = 0;
    }
    if (typeof parsed.manualProgressPct !== "number") {
      parsed.manualProgressPct = 0;
    }
    if (!parsed.runtime) {
      parsed.runtime = {
        sessionId: null,
        currentStage: null,
        stageStartedAt: null,
        timeoutCount: 0,
        retryCount: 0,
        idbPersistDurationMs: null,
        lastCloudRequestDurationMs: null,
      };
    }
    if (!parsed.certificationWarnings) {
      parsed.certificationWarnings = [];
    }
    return parsed;
  } catch {
    return null;
  }
}

/** True only while download/hydrate is in flight — does not block after core unlock (Phase 24.1BB). */
export function isCloudRecoveryLockActive(): boolean {
  return session.status === "active";
}

/** Background certification or optional modules still running. */
export function isCloudRecoveryBackgroundActive(): boolean {
  return session.status === "certifying" || session.status === "core_unlocked";
}

/** Full-screen blocking overlay required (probe fail or core download fail without usable data). */
export function isCloudRecoveryBlocking(): boolean {
  if (session.status === "active") return true;
  if (session.status === "failed") {
    const c = session.restoredCounts;
    const hasCore = c.products > 0 || c.sales > 0 || c.customers > 0;
    return !hasCore;
  }
  return false;
}

function newRecoverySessionId(): string {
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function beginCloudRecoverySession(): void {
  session = {
    status: "active",
    progressPhase: "downloading",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    currentStep: null,
    lastCompletedStep: null,
    progressFloorPct: 0,
    manualProgressPct: 0,
    runtime: { ...emptyRuntime(), sessionId: newRecoverySessionId(), currentStage: "starting" },
    downloadedCounts: emptyCounts(),
    restoredCounts: emptyCounts(),
    entityCounts: emptyCounts(),
    integrityDiagnostics: emptyIntegrityDiagnostics(),
    certification: null,
    certificationWarnings: [],
    errorMessage: null,
    errorKey: null,
    validation: null,
    completeness: null,
    completedWithInventoryWarnings: false,
    completionMessage: null,
  };
  emit();
}

export function setRecoveryProgressPhase(phase: CloudRecoverySessionState["progressPhase"]): void {
  session.progressPhase = phase;
  emit();
}

export function unlockCoreRecoverySession(): void {
  if (session.status !== "active") return;
  session.status = "core_unlocked";
  session.progressPhase = "validating";
  emit();
}

export function beginBackgroundCertification(): void {
  session.status = "certifying";
  session.progressPhase = "validating";
  emit();
}

export function recordCertificationWarnings(warnings: string[], message?: string | null): void {
  session.certificationWarnings = [...warnings];
  if (message) session.completionMessage = message;
  session.status = "core_unlocked";
  session.progressPhase = "validating";
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
  session.progressFloorPct = Math.max(session.progressFloorPct, progressPctForStep(step));
  session.manualProgressPct = 0;
  if (counts) {
    session.downloadedCounts = { ...session.downloadedCounts, ...counts };
  }
  emit();
}

export function reportRecoveryManualProgress(pct: number): void {
  if (session.status !== "active") return;
  session.manualProgressPct = Math.max(session.manualProgressPct, Math.min(DOWNLOAD_PROGRESS_CAP, pct));
  session.progressFloorPct = Math.max(session.progressFloorPct, session.manualProgressPct);
  emit();
}

export function recordRecoveryRuntime(patch: Partial<RecoveryRuntimeDiagnostics>): void {
  session.runtime = { ...session.runtime, ...patch };
  emit();
}

export function recordRecoveryTimeout(): void {
  session.runtime = { ...session.runtime, timeoutCount: session.runtime.timeoutCount + 1 };
  emit();
}

export function recordRecoveryRetry(): void {
  session.runtime = { ...session.runtime, retryCount: session.runtime.retryCount + 1 };
  emit();
}

export function unlockCoreRecoveryWithDegradedValidation(
  validation: CloudRecoveryValidationResult,
  message: string,
): void {
  if (session.status !== "active" && session.status !== "failed") return;
  session.status = "core_unlocked";
  session.progressPhase = "validating";
  session.validation = validation;
  session.errorMessage = null;
  session.errorKey = null;
  session.completedWithInventoryWarnings = true;
  session.completionMessage = message;
  session.certificationWarnings = [...(session.certificationWarnings ?? []), "recovery_degraded_unlock"];
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
  opts?: { inventoryWarnings?: boolean; message?: string | null },
): void {
  const finishedAt = new Date().toISOString();
  const startedMs = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  session = {
    ...session,
    status: "complete",
    progressPhase: "complete",
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
    completedWithInventoryWarnings: opts?.inventoryWarnings === true,
    completionMessage: opts?.message ?? null,
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
    progressPhase: "downloading",
    finishedAt,
    durationMs: Date.now() - startedMs,
    errorMessage,
    errorKey,
    validation,
    completeness: null,
    entityCounts: { ...session.restoredCounts },
    certification: session.certification,
    completedWithInventoryWarnings: false,
    completionMessage: null,
    progressFloorPct: session.progressFloorPct,
    manualProgressPct: session.manualProgressPct,
  };
  persistDiagnostics();
  emit();
}

export function resetCloudRecoverySessionForRetry(): void {
  session = {
    status: "idle",
    progressPhase: "downloading",
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    currentStep: null,
    lastCompletedStep: null,
    progressFloorPct: 0,
    manualProgressPct: 0,
    runtime: emptyRuntime(),
    downloadedCounts: emptyCounts(),
    restoredCounts: emptyCounts(),
    entityCounts: emptyCounts(),
    integrityDiagnostics: emptyIntegrityDiagnostics(),
    certification: null,
    certificationWarnings: [],
    errorMessage: null,
    errorKey: null,
    validation: null,
    completeness: null,
    completedWithInventoryWarnings: false,
    completionMessage: null,
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
