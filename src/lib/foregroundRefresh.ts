/**
 * WHEN SHOULD A LIVE SURFACE RE-READ? One shared answer, for web and native.
 *
 * THE PROBLEM THIS EXISTS FOR. A POS terminal is not a browser tab someone wanders
 * away from — it sits in the foreground, on one screen, for a whole shift. No
 * `visibilitychange` ever fires for it. So a surface that re-reads only on a
 * visibility *transition* keeps showing the plan and the price it read at boot,
 * and an admin changing a campaign price has no way to reach it short of asking
 * the shop to reload.
 *
 * SO THERE ARE THREE SIGNALS, and they are deliberately one mechanism rather than
 * three independent ones:
 *
 *   resume()  the tab became visible, or the native app became active. Capacitor
 *             fires BOTH on Android resume, so they collapse into a single run
 *             instead of racing each other.
 *   tick      a bounded interval, armed only while visible. This is the one that
 *             reaches a terminal that never loses focus.
 *   stop()    unmount. Nothing outlives the surface that asked for it.
 *
 * OVERLAP IS CLOSED HERE, NOT AT THE CALL SITE. A run still in flight is never
 * joined by a second one; a signal that arrives during a run is remembered and
 * replayed once it settles, so a resume during a slow request is delayed rather
 * than dropped. Callers still need their own ordering guard before writing state
 * — this stops the pile-up, it does not decide which answer is newest.
 *
 * The clock is injected so the schedule is testable without real elapsed time.
 */

export type TimerHandle = ReturnType<typeof setTimeout>;

export type RefreshClock = {
  setInterval: (fn: () => void, ms: number) => TimerHandle;
  clearInterval: (handle: TimerHandle) => void;
  setTimeout: (fn: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

export const realRefreshClock: RefreshClock = {
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

/**
 * 60s. The requirement is that a terminal left open picks up an admin's price
 * change "without a manual reload"; a minute is well inside what an operator
 * would call immediate, and it is one indexed read of a small, stable table per
 * surface per minute — far below any Supabase rate limit, and unchanged in cost
 * whether the shop is idle or busy.
 */
export const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

/** How long to wait for the second of a visibility/resume pair before running. */
const DEFAULT_COALESCE_MS = 400;

export type ForegroundRefreshOptions = {
  run: () => void | Promise<void>;
  intervalMs: number;
  coalesceMs?: number;
  clock?: RefreshClock;
  onError?: (error: unknown) => void;
};

export type ForegroundRefresher = {
  /** A surface became visible, or the native app became active. Coalesced. */
  resume: () => void;
  /** Hidden or backgrounded: stop the interval and drop any pending run. */
  hide: () => void;
  /** Arm polling when the surface starts out visible. Never runs immediately. */
  start: (visible: boolean) => void;
  /** Stop everything. Idempotent. */
  stop: () => void;
  /** A run is in flight, or one is scheduled. */
  busy: () => boolean;
  /** The periodic tick is armed. */
  polling: () => boolean;
};

export function createForegroundRefresher(options: ForegroundRefreshOptions): ForegroundRefresher {
  const clock = options.clock ?? realRefreshClock;
  const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;

  let intervalTimer: TimerHandle | null = null;
  let coalesceTimer: TimerHandle | null = null;
  let inFlight = false;
  let replayRequested = false;
  let stopped = false;

  const finish = (): void => {
    inFlight = false;
    if (stopped) return;
    if (replayRequested) {
      replayRequested = false;
      execute();
    }
  };

  /**
   * A run that returns void is FINISHED when it returns. Awaiting it anyway would
   * hold `inFlight` open for a microtask, during which the next signal would be
   * misread as overlapping and deferred — a real read reported as a duplicate.
   * Only a genuine promise is treated as work still in progress.
   */
  function execute(): void {
    if (stopped) return;
    if (inFlight) {
      // Never stack reads. Remember the ask and replay it on settle so that a
      // resume arriving mid-request is delayed, not silently dropped.
      replayRequested = true;
      return;
    }
    inFlight = true;

    let result: void | Promise<void>;
    try {
      result = options.run();
    } catch (error) {
      options.onError?.(error);
      finish();
      return;
    }

    if (typeof (result as { then?: unknown } | undefined)?.then !== "function") {
      finish();
      return;
    }

    void (result as Promise<void>).then(finish, (error) => {
      options.onError?.(error);
      finish();
    });
  }

  const startPolling = (): void => {
    if (stopped || intervalTimer != null) return;
    intervalTimer = clock.setInterval(execute, options.intervalMs);
  };

  const stopPolling = (): void => {
    if (intervalTimer == null) return;
    clock.clearInterval(intervalTimer);
    intervalTimer = null;
  };

  const cancelPending = (): void => {
    if (coalesceTimer == null) return;
    clock.clearTimeout(coalesceTimer);
    coalesceTimer = null;
  };

  const resume = (): void => {
    if (stopped) return;
    // The coalesce IS the dedupe: the second signal of a visibility/resume pair
    // finds a run already queued and adds nothing to it.
    if (coalesceTimer == null) {
      coalesceTimer = clock.setTimeout(() => {
        coalesceTimer = null;
        execute();
      }, Math.max(0, coalesceMs));
    }
    startPolling();
  };

  const hide = (): void => {
    cancelPending();
    stopPolling();
  };

  const start = (visible: boolean): void => {
    if (stopped) return;
    if (visible) startPolling();
  };

  const stop = (): void => {
    stopped = true;
    cancelPending();
    stopPolling();
    replayRequested = false;
  };

  return {
    resume,
    hide,
    start,
    stop,
    busy: () => inFlight || coalesceTimer != null,
    polling: () => intervalTimer != null,
  };
}
