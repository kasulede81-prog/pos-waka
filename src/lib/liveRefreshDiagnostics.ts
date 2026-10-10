import { reportSwallowedSyncFailure } from "./monitoring";

/**
 * A live refresh failed and the surface kept showing what it already had.
 *
 * THAT IS THE RIGHT BEHAVIOUR AND THE WRONG SILENCE. Keeping the last good plan
 * and price beats blanking them, so nothing user-facing changes here. But a
 * refresh that fails every minute on a shop's terminal is a real fault that was,
 * until now, indistinguishable from a refresh that succeeded — the screen looks
 * identical either way, and the old code returned `null` and moved on.
 *
 * WHAT IS RECORDED: which surface, and why. Never an amount, a token, a phone
 * number or a payload — a refresh failure is a transport fact, and the message is
 * truncated by `reportSwallowedSyncFailure` before it reaches monitoring.
 */

export type LiveRefreshSurface =
  | "subscription"
  | "public_pricing"
  | "checkout_quote"
  | "device_limit"
  | "subscription_history";

export type LiveRefreshFailure = {
  at: string;
  surface: LiveRefreshSurface;
  reason: string;
};

const MAX_EVENTS = 25;
let recentFailures: LiveRefreshFailure[] = [];

export function logLiveRefreshFailure(
  surface: LiveRefreshSurface,
  error: unknown,
  extra?: Record<string, string | number | boolean>,
): LiveRefreshFailure {
  const reason =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown_error";
  const event: LiveRefreshFailure = {
    at: new Date().toISOString(),
    surface,
    reason: reason.slice(0, 180),
  };
  recentFailures = [event, ...recentFailures].slice(0, MAX_EVENTS);
  reportSwallowedSyncFailure(`live_refresh_failed:${surface}`, error, extra);
  return event;
}

/**
 * Report a failure ONCE PER EPISODE, not once per attempt.
 *
 * These surfaces now retry every 60 seconds. A shop that genuinely cannot read
 * its subscription would otherwise emit 1,440 identical events a day per terminal
 * and bury the signal it was meant to raise. A repeated reason is therefore
 * suppressed until the surface either recovers or fails differently.
 */
export type RefreshFailureReporter = {
  report: (error: unknown, extra?: Record<string, string | number | boolean>) => void;
  /** Call on any successful read, so the next failure is reported again. */
  clear: () => void;
  /** The reason currently being suppressed, or null. */
  currentReason: () => string | null;
};

export function createRefreshFailureReporter(surface: LiveRefreshSurface): RefreshFailureReporter {
  let lastReason: string | null = null;
  return {
    report: (error, extra) => {
      const reason =
        error instanceof Error ? error.message : typeof error === "string" ? error : "unknown_error";
      if (reason === lastReason) return;
      lastReason = reason;
      logLiveRefreshFailure(surface, error, extra);
    },
    clear: () => {
      lastReason = null;
    },
    currentReason: () => lastReason,
  };
}

export function getRecentLiveRefreshFailures(): LiveRefreshFailure[] {
  return [...recentFailures];
}

export function clearLiveRefreshFailures(): void {
  recentFailures = [];
}
