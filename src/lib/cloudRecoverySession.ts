/**
 * Cloud recovery session — P0 recovery lock state, progress, and diagnostics.
 */

import type { CloudRecoveryValidationResult } from "./cloudRecoveryValidator";
import type { RecoveryCompletenessReport } from "./cloudRecoveryCompleteness";

export type CloudRecoveryStepId =
  | "probing"
  | "snapshot"
  | "products"
  | "sales"
  | "customers"
  | "inventory"
  | "shifts"
  | "day_closes"
  | "cash"
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

export type CloudRecoverySessionState = {
  status: "idle" | "active" | "failed" | "complete";
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  currentStep: CloudRecoveryStepId | null;
  lastCompletedStep: CloudRecoveryStepId | null;
  entityCounts: CloudRecoveryEntityCounts;
  errorMessage: string | null;
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

let session: CloudRecoverySessionState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  currentStep: null,
  lastCompletedStep: null,
  entityCounts: emptyCounts(),
  errorMessage: null,
  validation: null,
  completeness: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function persistDiagnostics(): void {
  try {
    const payload: CloudRecoveryDiagnostics = {
      ...session,
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
  return {
    ...session,
    entityCounts: { ...session.entityCounts },
  };
}

export function readLastCloudRecoveryDiagnostics(): CloudRecoveryDiagnostics | null {
  try {
    const raw = localStorage.getItem(DIAGNOSTICS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CloudRecoveryDiagnostics;
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
    entityCounts: emptyCounts(),
    errorMessage: null,
    validation: null,
    completeness: null,
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
    session.entityCounts = { ...session.entityCounts, ...counts };
  }
  emit();
}

export function updateRecoveryEntityCounts(counts: Partial<CloudRecoveryEntityCounts>): void {
  session.entityCounts = { ...session.entityCounts, ...counts };
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
    completeness,
  };
  persistDiagnostics();
  emit();
}

export function failCloudRecoverySession(
  errorMessage: string,
  validation: CloudRecoveryValidationResult | null = null,
): void {
  const finishedAt = new Date().toISOString();
  const startedMs = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  session = {
    ...session,
    status: "failed",
    finishedAt,
    durationMs: Date.now() - startedMs,
    errorMessage,
    validation,
    completeness: null,
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
    entityCounts: emptyCounts(),
    errorMessage: null,
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
