/**
 * Startup step tracking, stall detection, crash-safe recovery, and diagnostics persistence.
 */

import { getActiveAccountKey } from "../offline/accountScope";
import { getCloudRecoverySession, readLastCloudRecoveryDiagnostics, resetCloudRecoverySessionForRetry } from "./cloudRecoverySession";

export type StartupStepId =
  | "app_launch"
  | "capacitor_init"
  | "language_load"
  | "auth_session"
  | "local_disk"
  | "recovery_check"
  | "cloud_probe"
  | "cloud_recovery"
  | "downloading_products"
  | "downloading_sales"
  | "downloading_customers"
  | "downloading_inventory"
  | "downloading_shifts"
  | "finalizing"
  | "ready";

export type StartupStepHistoryEntry = {
  step: StartupStepId;
  at: string;
};

export type StartupDiagnosticsSnapshot = {
  sessionId: string;
  startedAt: string;
  lastStepAt: string;
  currentStep: StartupStepId;
  lastSuccessfulStep: StartupStepId | null;
  durationMs: number;
  recoveryDurationMs: number | null;
  failureReason: string | null;
  recoveryErrorKey: string | null;
  splashHiddenAt: string | null;
  stallDetectedAt: string | null;
  crashRecoveryApplied: boolean;
  history: StartupStepHistoryEntry[];
};

const DIAGNOSTICS_KEY = "waka.startup.diagnostics.v1";
const SESSION_KEY = "waka.startup.session.v1";
const OFFLINE_BYPASS_KEY = "waka.startup.offlineRecoveryBypass.v1";

const STALE_STARTUP_MS = 120_000;
const OFFLINE_BYPASS_MAX_MS = 24 * 60 * 60 * 1000;

type PersistedSession = {
  sessionId: string;
  startedAt: string;
  lastStepAt: string;
  currentStep: StartupStepId;
  lastSuccessfulStep: StartupStepId | null;
  failureReason: string | null;
  recoveryErrorKey: string | null;
  splashHiddenAt: string | null;
  stallDetectedAt: string | null;
  crashRecoveryApplied: boolean;
  history: StartupStepHistoryEntry[];
};

let session: PersistedSession = createFreshSession();

const listeners = new Set<() => void>();

function createFreshSession(): PersistedSession {
  const now = new Date().toISOString();
  return {
    sessionId: crypto.randomUUID(),
    startedAt: now,
    lastStepAt: now,
    currentStep: "app_launch",
    lastSuccessfulStep: "app_launch",
    failureReason: null,
    recoveryErrorKey: null,
    splashHiddenAt: null,
    stallDetectedAt: null,
    crashRecoveryApplied: false,
    history: [{ step: "app_launch", at: now }],
  };
}

function emit(): void {
  for (const fn of listeners) fn();
}

function persist(): void {
  try {
    localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(getStartupDiagnosticsSnapshot()));
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* quota */
  }
}

export function subscribeStartupDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recordStartupStep(step: StartupStepId, opts?: { failureReason?: string | null }): void {
  const now = new Date().toISOString();
  session.currentStep = step;
  session.lastStepAt = now;
  if (opts?.failureReason !== undefined) {
    session.failureReason = opts.failureReason;
  } else if (step !== "ready") {
    session.failureReason = null;
  }
  if (step !== session.history[session.history.length - 1]?.step) {
    session.history.push({ step, at: now });
    if (session.history.length > 40) session.history.shift();
  }
  if (step === "ready" || step === "local_disk" || step === "auth_session") {
    session.lastSuccessfulStep = step;
  }
  persist();
  emit();
}

/** Mark finalizing only after cloud recovery validation passes. */
export function recordStartupRecoveryValidated(): void {
  recordStartupStep("finalizing");
}

export function recordStartupRecoveryFailure(message: string, errorKey: string): void {
  const now = new Date().toISOString();
  session.currentStep = "cloud_recovery";
  session.lastStepAt = now;
  session.failureReason = message;
  session.recoveryErrorKey = errorKey;
  if (session.history[session.history.length - 1]?.step !== "cloud_recovery") {
    session.history.push({ step: "cloud_recovery", at: now });
    if (session.history.length > 40) session.history.shift();
  }
  persist();
  emit();
}

export function markStartupSplashHidden(): void {
  if (session.splashHiddenAt) return;
  session.splashHiddenAt = new Date().toISOString();
  persist();
  emit();
}

export function markStartupStalled(): void {
  if (session.stallDetectedAt) return;
  session.stallDetectedAt = new Date().toISOString();
  persist();
  emit();
}

export function clearStartupStall(): void {
  session.stallDetectedAt = null;
  session.failureReason = null;
  const now = new Date().toISOString();
  session.lastStepAt = now;
  persist();
  emit();
}

export function getStartupDiagnosticsSnapshot(): StartupDiagnosticsSnapshot {
  const startedMs = new Date(session.startedAt).getTime();
  const recovery = readLastCloudRecoveryDiagnostics();
  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    lastStepAt: session.lastStepAt,
    currentStep: session.currentStep,
    lastSuccessfulStep: session.lastSuccessfulStep,
    durationMs: Date.now() - startedMs,
    recoveryDurationMs: recovery?.durationMs ?? getCloudRecoverySession().durationMs,
    failureReason: session.failureReason ?? recovery?.errorMessage ?? null,
    recoveryErrorKey: session.recoveryErrorKey ?? recovery?.errorKey ?? null,
    splashHiddenAt: session.splashHiddenAt,
    stallDetectedAt: session.stallDetectedAt,
    crashRecoveryApplied: session.crashRecoveryApplied,
    history: [...session.history],
  };
}

export function readPersistedStartupDiagnostics(): StartupDiagnosticsSnapshot | null {
  try {
    const raw = localStorage.getItem(DIAGNOSTICS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StartupDiagnosticsSnapshot;
  } catch {
    return null;
  }
}

export function startupStepLabelKey(step: StartupStepId): string {
  const map: Record<StartupStepId, string> = {
    app_launch: "startupStepAppLaunch",
    capacitor_init: "startupStepCapacitorInit",
    language_load: "startupStepLanguageLoad",
    auth_session: "startupStepAuthSession",
    local_disk: "startupStepLocalDisk",
    recovery_check: "startupStepRecoveryCheck",
    cloud_probe: "startupStepCloudProbe",
    cloud_recovery: "startupStepCloudRecovery",
    downloading_products: "startupStepDownloadingProducts",
    downloading_sales: "startupStepDownloadingSales",
    downloading_customers: "startupStepDownloadingCustomers",
    downloading_inventory: "startupStepDownloadingInventory",
    downloading_shifts: "startupStepDownloadingShifts",
    finalizing: "startupStepFinalizing",
    ready: "startupStepReady",
  };
  return map[step];
}

type OfflineBypass = { accountKey: string; at: string };

export function setRecoveryOfflineBypass(): void {
  const accountKey = getActiveAccountKey();
  if (!accountKey) return;
  try {
    localStorage.setItem(
      OFFLINE_BYPASS_KEY,
      JSON.stringify({ accountKey, at: new Date().toISOString() } satisfies OfflineBypass),
    );
  } catch {
    /* ignore */
  }
}

export function isRecoveryOfflineBypassActive(): boolean {
  try {
    const raw = localStorage.getItem(OFFLINE_BYPASS_KEY);
    if (!raw) return false;
    const row = JSON.parse(raw) as OfflineBypass;
    if (row.accountKey !== getActiveAccountKey()) return false;
    const age = Date.now() - new Date(row.at).getTime();
    return age >= 0 && age < OFFLINE_BYPASS_MAX_MS;
  } catch {
    return false;
  }
}

export function clearRecoveryOfflineBypass(): void {
  try {
    localStorage.removeItem(OFFLINE_BYPASS_KEY);
  } catch {
    /* ignore */
  }
}

/** Clear stuck recovery/startup state after force-close or stale session. */
export function recoverStuckStartupState(): void {
  const now = Date.now();

  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as PersistedSession;
      const stale = now - new Date(prev.lastStepAt).getTime() > STALE_STARTUP_MS;
      if (stale && prev.currentStep !== "ready") {
        session = createFreshSession();
        session.crashRecoveryApplied = true;
        session.failureReason = "Recovered from interrupted startup";
      } else {
        session = prev;
      }
    }
  } catch {
    session = createFreshSession();
  }

  const recovery = getCloudRecoverySession();
  if (recovery.status === "active") {
    resetCloudRecoverySessionForRetry();
    session.crashRecoveryApplied = true;
    persist();
    emit();
  }
}

export function resetStartupSessionForRetry(): void {
  session = createFreshSession();
  persist();
  emit();
}
