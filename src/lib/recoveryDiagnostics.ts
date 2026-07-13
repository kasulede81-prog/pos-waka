/**
 * Phase 24.2A — [waka-recovery] timeline diagnostics (no credentials).
 */

export type RecoveryDiagEvent =
  | "download_start"
  | "download_step"
  | "persist"
  | "core_unlock"
  | "certification_start"
  | "certification_end"
  | "validation"
  | "finalize"
  | "complete"
  | "retry"
  | "resume"
  | "certification_warning"
  | "timeout";

type Mark = {
  event: RecoveryDiagEvent;
  at: string;
  elapsedMs: number;
  detail?: Record<string, string | number | boolean | null>;
};

const originMs = typeof performance !== "undefined" ? performance.now() : 0;
const marks: Mark[] = [];
const MAX_MARKS = 96;

const perfMarks: Record<string, number | null> = {
  authMs: null,
  shellVisibleMs: null,
  snapshotDownloadMs: null,
  idbPersistMs: null,
  validationMs: null,
  coreRecoveredMs: null,
  posUnlockedMs: null,
  certificationFinishedMs: null,
  recoveryCompletedMs: null,
};

function shouldLog(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return globalThis.localStorage?.getItem("waka.recovery.log") === "1";
  } catch {
    return false;
  }
}

export function logRecovery(
  event: RecoveryDiagEvent,
  detail?: Record<string, string | number | boolean | null>,
): void {
  const elapsedMs = Math.round(performance.now() - originMs);
  marks.push({ event, at: new Date().toISOString(), elapsedMs, detail });
  if (marks.length > MAX_MARKS) marks.shift();
  if (shouldLog()) {
    const payload = detail ? ` ${JSON.stringify(detail)}` : "";
    console.info(`[waka-recovery] ${event} +${elapsedMs}ms${payload}`);
  }
}

export function markRecoveryPerf(key: keyof typeof perfMarks): void {
  perfMarks[key] = Math.round(performance.now() - originMs);
  logRecovery("download_step", { perf: key, ms: perfMarks[key] });
}

export function readRecoveryDiagnosticsSnapshot(): {
  marks: readonly Mark[];
  perf: Readonly<typeof perfMarks>;
} {
  return { marks: [...marks], perf: { ...perfMarks } };
}

export function resetRecoveryDiagnostics(): void {
  marks.length = 0;
  for (const k of Object.keys(perfMarks) as (keyof typeof perfMarks)[]) {
    perfMarks[k] = null;
  }
}
