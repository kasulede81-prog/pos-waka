/**
 * Phase 24.1B — sync timeline diagnostics ([waka-sync]).
 * No credentials or business-sensitive payloads are logged.
 *
 * OBS-1 (bounded, best-effort): queue gauges + sale/scan attempt counters.
 * Diagnostics observe sync; they must NEVER influence queue/retry/scheduler.
 * In-memory only — reset on restart is expected.
 */

export type SyncDiagEvent =
  | "enqueue"
  | "enqueue_latency"
  | "push_start"
  | "push_end"
  | "ack"
  | "pull_start"
  | "pull_end"
  | "pull_scheduled"
  | "realtime_event"
  | "merge_start"
  | "merge_end"
  | "retry"
  | "coalesce"
  | "queue_depth"
  | "checkpoint"
  /** OBS-1 attempt markers (diagnostic only; never drive sync). */
  | "sale_push_immediate_attempt"
  | "sale_push_queue_attempt"
  | "sale_push_pending_sync_attempt"
  | "pending_sync_scan_push_attempt";

export type SyncConnectionQuality = "excellent" | "good" | "slow" | "offline" | "reconnecting";

/** Minimal queue row fields for OBS-1 gauges — never include payloads. */
export type Obs1QueueRowView = {
  kind: string;
  attempts: number;
};

type Mark = {
  event: SyncDiagEvent;
  at: string;
  elapsedMs: number;
  detail?: Record<string, string | number | boolean | null>;
};

const originMs = typeof performance !== "undefined" ? performance.now() : 0;
const marks: Mark[] = [];
const MAX_MARKS = 64;

let lastPushDurationMs: number | null = null;
let lastPullDurationMs: number | null = null;
let lastMergeDurationMs: number | null = null;
let lastRealtimeLatencyMs: number | null = null;
let lastEnqueueLatencyMs: number | null = null;
let lastAckLatencyMs: number | null = null;
let lastQueueDepth: number | null = null;
let lastRetryCount = 0;
let lastCheckpointDurationMs: number | null = null;
let lastRealtimeEventAt: number | null = null;
let reconnectingUntilMs: number | null = null;

/** OBS-1: point-in-time depth by SyncOperationKind (gauge; not historical). */
let lastQueueDepthByKind: Record<string, number> = {};
/**
 * OBS-1: histogram of current queue row `attempts` values only.
 * Not historical retry telemetry — rebuilt from each queue snapshot.
 */
let lastCurrentQueueAttemptsHistogram: Record<string, number> = {};
/**
 * OBS-1: current rows with attempts >= 100 (retained soft-stop, NOT dead-letter).
 */
let lastSoftStopRetainedCount = 0;
/** OBS-1 attempt counters (in-memory; intentional multi-path counting). */
let salePushImmediateAttempts = 0;
let salePushQueueAttempts = 0;
let salePushPendingSyncAttempts = 0;
let pendingSyncScanPushAttempts = 0;

const timelineMs: Record<string, number | null> = {
  commitToQueue: null,
  queueToUpload: null,
  uploadToAck: null,
  ackToPull: null,
  pullToMerge: null,
  mergeToVisible: null,
};

function shouldLog(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return globalThis.localStorage?.getItem("waka.sync.log") === "1";
  } catch {
    return false;
  }
}

/** Isolate observer work so throws never reach sync callers. */
export function safeObserve(fn: () => void): void {
  try {
    fn();
  } catch {
    /* OBS-1 must never alter sync */
  }
}

export function logSync(
  event: SyncDiagEvent,
  detail?: Record<string, string | number | boolean | null>,
): void {
  const elapsedMs = Math.round(performance.now() - originMs);
  marks.push({ event, at: new Date().toISOString(), elapsedMs, detail });
  if (marks.length > MAX_MARKS) marks.shift();
  if (shouldLog()) {
    const payload = detail ? ` ${JSON.stringify(detail)}` : "";
    console.info(`[waka-sync] ${event} +${elapsedMs}ms${payload}`);
  }
}

export function recordEnqueueLatency(ms: number): void {
  lastEnqueueLatencyMs = Math.round(ms);
  timelineMs.commitToQueue = lastEnqueueLatencyMs;
  logSync("enqueue_latency", { durationMs: lastEnqueueLatencyMs });
}

export function recordPushDuration(ms: number): void {
  lastPushDurationMs = Math.round(ms);
  timelineMs.queueToUpload = lastPushDurationMs;
  logSync("push_end", { durationMs: lastPushDurationMs });
}

export function recordAckLatency(ms: number): void {
  lastAckLatencyMs = Math.round(ms);
  timelineMs.uploadToAck = lastAckLatencyMs;
  logSync("ack", { durationMs: lastAckLatencyMs });
}

export function recordPullDuration(ms: number): void {
  lastPullDurationMs = Math.round(ms);
  timelineMs.ackToPull = lastPullDurationMs;
  logSync("pull_end", { durationMs: lastPullDurationMs });
}

export function recordMergeDuration(ms: number): void {
  lastMergeDurationMs = Math.round(ms);
  timelineMs.pullToMerge = lastMergeDurationMs;
  logSync("merge_end", { durationMs: lastMergeDurationMs });
}

export function recordCheckpointDuration(ms: number): void {
  lastCheckpointDurationMs = Math.round(ms);
  logSync("checkpoint", { durationMs: lastCheckpointDurationMs });
}

export function recordQueueDepth(depth: number): void {
  lastQueueDepth = depth;
  logSync("queue_depth", { depth });
}

/**
 * OBS-1 A/B/C — rebuild gauges from a queue snapshot (kind + attempts only).
 * Point-in-time; concurrent mutation may make the snapshot stale (acceptable).
 * Does not mutate queue rows. Does not inspect payloads.
 */
export function observeCurrentQueueMetrics(rows: ReadonlyArray<Obs1QueueRowView>): void {
  safeObserve(() => {
    const depthByKind: Record<string, number> = {};
    const histogram: Record<string, number> = {};
    let softStopRetained = 0;
    for (const row of rows) {
      const kind = String(row.kind);
      depthByKind[kind] = (depthByKind[kind] ?? 0) + 1;
      const attempts = Number(row.attempts);
      const n = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0;
      const bucket = n >= 100 ? "100+" : String(n);
      histogram[bucket] = (histogram[bucket] ?? 0) + 1;
      if (n >= 100) softStopRetained += 1;
    }
    lastQueueDepthByKind = depthByKind;
    lastCurrentQueueAttemptsHistogram = histogram;
    lastSoftStopRetainedCount = softStopRetained;
    lastQueueDepth = rows.length;
    logSync("queue_depth", {
      depth: rows.length,
      soft_stop_retained: softStopRetained,
      kinds: Object.keys(depthByKind).length,
    });
  });
}

/** OBS-1 D1 — SALE_PUSH_IMMEDIATE_ATTEMPT (attempt counter; not a business event). */
export function recordSalePushImmediateAttempt(): void {
  safeObserve(() => {
    salePushImmediateAttempts += 1;
    logSync("sale_push_immediate_attempt", { count: salePushImmediateAttempts });
  });
}

/** OBS-1 D2 — SALE_PUSH_QUEUE_ATTEMPT (attempt counter; not a business event). */
export function recordSalePushQueueAttempt(): void {
  safeObserve(() => {
    salePushQueueAttempts += 1;
    logSync("sale_push_queue_attempt", { count: salePushQueueAttempts });
  });
}

/** OBS-1 D3 — SALE_PUSH_PENDING_SYNC_ATTEMPT (attempt counter; not a business event). */
export function recordSalePushPendingSyncAttempt(): void {
  safeObserve(() => {
    salePushPendingSyncAttempts += 1;
    logSync("sale_push_pending_sync_attempt", { count: salePushPendingSyncAttempts });
  });
}

/**
 * OBS-1 E — PENDING_SYNC_SCAN_PUSH_ATTEMPT
 * Counts an invocation of the pendingSync scan push path (not labeled "recovery").
 */
export function recordPendingSyncScanPushAttempt(): void {
  safeObserve(() => {
    pendingSyncScanPushAttempts += 1;
    logSync("pending_sync_scan_push_attempt", { count: pendingSyncScanPushAttempts });
  });
}

/** Test helper — OBS-1 in-memory state only. */
export function resetObs1DiagnosticsForTests(): void {
  lastQueueDepthByKind = {};
  lastCurrentQueueAttemptsHistogram = {};
  lastSoftStopRetainedCount = 0;
  salePushImmediateAttempts = 0;
  salePushQueueAttempts = 0;
  salePushPendingSyncAttempts = 0;
  pendingSyncScanPushAttempts = 0;
}

export function recordSyncRetry(kind: string, attempts: number): void {
  lastRetryCount = attempts;
  logSync("retry", { kind, attempts });
}

export function markRealtimeEventReceived(): void {
  lastRealtimeEventAt = performance.now();
  logSync("realtime_event", { received: true });
}

export function consumeRealtimeToPullLatency(): number | null {
  if (lastRealtimeEventAt == null) return null;
  const ms = Math.round(performance.now() - lastRealtimeEventAt);
  lastRealtimeEventAt = null;
  lastRealtimeLatencyMs = ms;
  logSync("realtime_event", { latencyMs: ms });
  return ms;
}

export function markSyncReconnecting(durationMs = 5_000): void {
  reconnectingUntilMs = Date.now() + durationMs;
}

export function readSyncDiagnosticsSnapshot(): {
  marks: readonly Mark[];
  lastPushDurationMs: number | null;
  lastPullDurationMs: number | null;
  lastMergeDurationMs: number | null;
  lastRealtimeLatencyMs: number | null;
  lastEnqueueLatencyMs: number | null;
  lastAckLatencyMs: number | null;
  lastQueueDepth: number | null;
  lastRetryCount: number;
  lastCheckpointDurationMs: number | null;
  timelineMs: Readonly<typeof timelineMs>;
  /** OBS-1 gauges / attempt counters (diagnostic only). */
  obs1: {
    queueDepthByKind: Readonly<Record<string, number>>;
    /** Current-row attempts histogram — not historical retry telemetry. */
    currentQueueAttemptsHistogram: Readonly<Record<string, number>>;
    softStopRetainedCount: number;
    salePushImmediateAttempts: number;
    salePushQueueAttempts: number;
    salePushPendingSyncAttempts: number;
    pendingSyncScanPushAttempts: number;
  };
} {
  return {
    marks: [...marks],
    lastPushDurationMs,
    lastPullDurationMs,
    lastMergeDurationMs,
    lastRealtimeLatencyMs,
    lastEnqueueLatencyMs,
    lastAckLatencyMs,
    lastQueueDepth,
    lastRetryCount,
    lastCheckpointDurationMs,
    timelineMs: { ...timelineMs },
    obs1: {
      queueDepthByKind: { ...lastQueueDepthByKind },
      currentQueueAttemptsHistogram: { ...lastCurrentQueueAttemptsHistogram },
      softStopRetainedCount: lastSoftStopRetainedCount,
      salePushImmediateAttempts,
      salePushQueueAttempts,
      salePushPendingSyncAttempts,
      pendingSyncScanPushAttempts,
    },
  };
}

/** Connection quality — drives adaptive coalesce and batching (Phase 24.1B). */
export function syncConnectionQuality(isOnline: boolean): SyncConnectionQuality {
  if (!isOnline) return "offline";
  if (reconnectingUntilMs != null && Date.now() < reconnectingUntilMs) return "reconnecting";
  if (lastPushDurationMs != null && lastPushDurationMs > 6_000) return "slow";
  if (lastPushDurationMs != null && lastPushDurationMs > 3_000) return "good";
  if (lastPullDurationMs != null && lastPullDurationMs > 8_000) return "slow";
  if (lastPushDurationMs != null && lastPushDurationMs <= 1_200) return "excellent";
  return "good";
}

/** @deprecated Use syncConnectionQuality */
export function syncConnectionMode(isOnline: boolean): "healthy" | "degraded" | "offline" {
  const q = syncConnectionQuality(isOnline);
  if (q === "offline") return "offline";
  if (q === "slow" || q === "reconnecting") return "degraded";
  return "healthy";
}

export function coalesceMsForConnection(isOnline: boolean, baseMs: number): number {
  const q = syncConnectionQuality(isOnline);
  if (q === "offline" || q === "reconnecting") return baseMs * 3;
  if (q === "slow") return baseMs * 2;
  if (q === "good") return baseMs;
  return Math.max(80, Math.round(baseMs * 0.85));
}
