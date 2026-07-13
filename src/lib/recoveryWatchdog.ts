/**
 * Phase 24.2A — detect recovery stage stalls and log classified delays.
 */

import { logRecovery } from "./recoveryDiagnostics";

type StageWatch = {
  stage: string;
  startedAt: number;
  warnAfterMs: number;
  timerId: ReturnType<typeof setTimeout>;
};

let activeWatch: StageWatch | null = null;

export function beginRecoveryStageWatch(stage: string, warnAfterMs = 15_000): void {
  endRecoveryStageWatch();
  const startedAt = performance.now();
  const timerId = globalThis.setTimeout(() => {
    if (activeWatch?.stage !== stage) return;
    const elapsedMs = Math.round(performance.now() - startedAt);
    logRecovery("download_step", { watchdog: "stall", stage, elapsedMs });
  }, warnAfterMs);
  activeWatch = { stage, startedAt, warnAfterMs, timerId };
}

export function endRecoveryStageWatch(detail?: Record<string, string | number | boolean | null>): void {
  if (!activeWatch) return;
  globalThis.clearTimeout(activeWatch.timerId);
  const elapsedMs = Math.round(performance.now() - activeWatch.startedAt);
  logRecovery("download_step", { watchdog: "stage_end", stage: activeWatch.stage, elapsedMs, ...detail });
  activeWatch = null;
}

export function readActiveRecoveryStage(): string | null {
  return activeWatch?.stage ?? null;
}
