/**
 * Collapse native AppState + visibilitychange into one logical "resume" sync.
 */

export type ForegroundSyncJob = {
  reason: "resume";
  forcePush: boolean;
  forcePull: boolean;
};

type Pending = {
  run: (job: ForegroundSyncJob) => void;
  forcePush: boolean;
  forcePull: boolean;
};

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Pending | null = null;
let lastFiredAt = 0;
let scheduledCount = 0;
let firedCount = 0;

function mergePending(next: Pending): Pending {
  if (!pending) return next;
  return {
    run: next.run,
    forcePush: pending.forcePush || next.forcePush,
    forcePull: pending.forcePull || next.forcePull,
  };
}

/**
 * If both events fire within `delayMs`, they collapse into one resume sync.
 * Delay stays in the existing visibility/resume range — not a long backoff.
 */
export function scheduleForegroundSync(
  run: (job: ForegroundSyncJob) => void,
  delayMs: number,
  opts?: { forcePush?: boolean; forcePull?: boolean },
): void {
  scheduledCount += 1;
  const incoming: Pending = {
    run,
    forcePush: opts?.forcePush === true,
    forcePull: opts?.forcePull === true,
  };
  pending = mergePending(incoming);

  if (timer != null) return;

  const sinceLast = lastFiredAt > 0 ? Date.now() - lastFiredAt : Number.POSITIVE_INFINITY;
  if (sinceLast < delayMs) {
    pending = null;
    return;
  }

  timer = globalThis.setTimeout(() => {
    timer = null;
    const job = pending;
    pending = null;
    if (!job) return;
    lastFiredAt = Date.now();
    firedCount += 1;
    job.run({
      reason: "resume",
      forcePush: job.forcePush,
      forcePull: job.forcePull,
    });
  }, Math.max(0, delayMs));
}

export function resetForegroundSyncForTests(): void {
  if (timer != null) {
    globalThis.clearTimeout(timer);
    timer = null;
  }
  pending = null;
  lastFiredAt = 0;
  scheduledCount = 0;
  firedCount = 0;
}

export function foregroundSyncTestCounters(): { scheduled: number; fired: number; pending: boolean } {
  return { scheduled: scheduledCount, fired: firedCount, pending: pending != null || timer != null };
}
