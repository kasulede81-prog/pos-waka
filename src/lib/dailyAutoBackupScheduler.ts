/**
 * SYNC-INV-01 — daily auto-backup scheduling.
 *
 * Persist completion must only cheaply request a backup. The expensive
 * entity-store assemble runs at most once, deferred/idle, never on the persist
 * hot path, and never under the sync mutex.
 */
import { dateKeyKampala } from "./datesUg";
import { isNativeApp } from "./nativeApp";
import { runWhenIdle } from "./uiYield";
import { maybeAppendDailyAutoBackup } from "../offline/backupEngine";
import { getPersistenceNamespace } from "../offline/shopScope";

export const DAILY_AUTO_BACKUP_IDLE_TIMEOUT_WEB_MS = 1200;
export const DAILY_AUTO_BACKUP_IDLE_TIMEOUT_NATIVE_MS = 4000;

export type DailyAutoBackupScheduleRequest = {
  lastSavedDateKey: string | undefined;
  namespace: string | null;
  hydrated: boolean;
};

export type DailyAutoBackupScheduleResult =
  | "skipped_already_backed_up"
  | "skipped_not_hydrated"
  | "skipped_no_namespace"
  | "skipped_failed_today"
  | "coalesced"
  | "scheduled";

export type DailyAutoBackupSchedulerDeps = {
  now: () => Date;
  getNamespace: () => string | null;
  isHydrated: () => boolean;
  getLastSavedDateKey: () => string | undefined;
  onSuccess: (dateKey: string) => void;
  runBackup: (lastSavedDateKey: string | undefined, expectedNamespace: string) => Promise<string | undefined>;
  runIdle: (fn: () => void, timeoutMs: number) => void;
  idleTimeoutMs: () => number;
};

function defaultIdleTimeoutMs(): number {
  return isNativeApp() ? DAILY_AUTO_BACKUP_IDLE_TIMEOUT_NATIVE_MS : DAILY_AUTO_BACKUP_IDLE_TIMEOUT_WEB_MS;
}

function createDefaultDeps(): DailyAutoBackupSchedulerDeps {
  return {
    now: () => new Date(),
    getNamespace: getPersistenceNamespace,
    isHydrated: () => true,
    getLastSavedDateKey: () => undefined,
    onSuccess: () => undefined,
    runBackup: (lastSaved, expectedNamespace) =>
      maybeAppendDailyAutoBackup(lastSaved, { expectedNamespace }),
    runIdle: runWhenIdle,
    idleTimeoutMs: defaultIdleTimeoutMs,
  };
}

let deps = createDefaultDeps();
let generation = 0;
let inFlight = false;
let idleQueued = false;
let scheduledNamespace: string | null = null;
let parked: DailyAutoBackupScheduleRequest | null = null;
let failedNamespace: string | null = null;
let failedDateKey: string | null = null;

export function configureDailyAutoBackupScheduler(partial: Partial<DailyAutoBackupSchedulerDeps>): void {
  deps = { ...deps, ...partial };
}

export function resetDailyAutoBackupSchedulerForTests(): void {
  generation += 1;
  inFlight = false;
  idleQueued = false;
  scheduledNamespace = null;
  parked = null;
  failedNamespace = null;
  failedDateKey = null;
  deps = createDefaultDeps();
}

/** Drop a deferred/in-flight claim so a later account/shop cannot inherit it. */
export function invalidateDailyAutoBackupSchedule(): void {
  generation += 1;
  idleQueued = false;
  scheduledNamespace = null;
  parked = null;
}

export function getDailyAutoBackupSchedulerDiagnostics(): {
  inFlight: boolean;
  idleQueued: boolean;
  scheduledNamespace: string | null;
  failedDateKey: string | null;
  failedNamespace: string | null;
} {
  return {
    inFlight,
    idleQueued,
    scheduledNamespace,
    failedDateKey,
    failedNamespace,
  };
}

function todayKey(): string {
  return dateKeyKampala(deps.now());
}

function failedToday(namespace: string, today: string): boolean {
  return failedNamespace === namespace && failedDateKey === today;
}

export function scheduleDailyAutoBackup(req: DailyAutoBackupScheduleRequest): DailyAutoBackupScheduleResult {
  if (!req.hydrated) return "skipped_not_hydrated";
  if (!req.namespace) return "skipped_no_namespace";

  const today = todayKey();
  const lastSaved = req.lastSavedDateKey ?? deps.getLastSavedDateKey();
  if (lastSaved === today) return "skipped_already_backed_up";
  if (failedToday(req.namespace, today)) return "skipped_failed_today";

  if (inFlight || idleQueued) {
    if (scheduledNamespace === req.namespace) return "coalesced";
    parked = req;
    return "coalesced";
  }

  scheduledNamespace = req.namespace;
  idleQueued = true;
  const gen = generation;
  deps.runIdle(() => {
    if (generation !== gen) return;
    idleQueued = false;
    void executeDailyAutoBackup(gen, req.namespace as string);
  }, deps.idleTimeoutMs());
  return "scheduled";
}

async function executeDailyAutoBackup(gen: number, expectedNamespace: string): Promise<void> {
  if (generation !== gen || inFlight) {
    if (inFlight && expectedNamespace) {
      parked = {
        lastSavedDateKey: deps.getLastSavedDateKey(),
        namespace: expectedNamespace,
        hydrated: deps.isHydrated(),
      };
    }
    return;
  }

  const today = todayKey();
  const currentNs = deps.getNamespace();
  if (!currentNs || currentNs !== expectedNamespace) return;
  if (!deps.isHydrated()) return;
  if (failedToday(currentNs, today)) return;

  const lastSaved = deps.getLastSavedDateKey();
  if (lastSaved === today) return;

  inFlight = true;
  try {
    const result = await deps.runBackup(lastSaved, expectedNamespace);
    if (generation !== gen || deps.getNamespace() !== expectedNamespace) {
      return;
    }
    if (result === today) {
      deps.onSuccess(result);
    } else {
      failedNamespace = expectedNamespace;
      failedDateKey = today;
    }
  } catch {
    if (generation === gen) {
      failedNamespace = expectedNamespace;
      failedDateKey = today;
    }
  } finally {
    inFlight = false;
    const next = parked;
    parked = null;
    if (next && generation === gen) {
      scheduleDailyAutoBackup({
        lastSavedDateKey: deps.getLastSavedDateKey(),
        hydrated: deps.isHydrated(),
        namespace: deps.getNamespace(),
      });
    }
  }
}
