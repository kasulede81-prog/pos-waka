/**
 * Single-flight + coalesce for incremental cloud pulls.
 * Push remains on its own mutex; this only serializes overlapping pulls.
 */

import { isPullReasonSubset, mergeSyncPullReasons } from "./syncReasons";

export type CoalescedPullJob = {
  reason: string;
  force?: boolean;
};

export function createIncrementalPullCoalescer(handlers: {
  delayMsForReason: (reason: string) => number;
  run: (job: CoalescedPullJob) => Promise<boolean>;
}): {
  schedule: (reason: string, opts?: { force?: boolean }) => void;
  pendingReason: () => string | null;
  inFlightReason: () => string | null;
  reset: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: CoalescedPullJob | null = null;
  let inFlight: Promise<boolean> | null = null;
  let inFlightJob: CoalescedPullJob | null = null;
  let followUp: CoalescedPullJob | null = null;

  function mergeJobs(a: CoalescedPullJob, b: CoalescedPullJob): CoalescedPullJob {
    return {
      reason: mergeSyncPullReasons(a.reason, b.reason),
      force: a.force === true || b.force === true,
    };
  }

  function startJob(job: CoalescedPullJob): void {
    inFlightJob = job;
    inFlight = handlers
      .run(job)
      .catch(() => false)
      .finally(() => {
        inFlight = null;
        inFlightJob = null;
        const next = followUp;
        followUp = null;
        if (next) schedule(next.reason, { force: next.force });
      });
  }

  function schedule(reason: string, opts?: { force?: boolean }): void {
    const incoming: CoalescedPullJob = { reason, force: opts?.force };

    if (inFlight) {
      if (inFlightJob && isPullReasonSubset(incoming.reason, inFlightJob.reason)) {
        return;
      }
      followUp = followUp ? mergeJobs(followUp, incoming) : incoming;
      return;
    }

    pending = pending ? mergeJobs(pending, incoming) : incoming;
    const delay = Math.min(
      handlers.delayMsForReason(pending.reason),
      handlers.delayMsForReason(incoming.reason),
    );
    if (timer != null) globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => {
      timer = null;
      const job = pending;
      pending = null;
      if (!job) return;
      startJob(job);
    }, Math.max(0, delay));
  }

  return {
    schedule,
    pendingReason: () => pending?.reason ?? followUp?.reason ?? null,
    inFlightReason: () => inFlightJob?.reason ?? null,
    reset: () => {
      if (timer != null) globalThis.clearTimeout(timer);
      timer = null;
      pending = null;
      followUp = null;
      inFlight = null;
      inFlightJob = null;
    },
  };
}
