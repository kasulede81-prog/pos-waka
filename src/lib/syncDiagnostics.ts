/**
 * Phase 24.1B — sync timeline diagnostics ([waka-sync]).
 * No credentials or business-sensitive payloads are logged.
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
  | "checkpoint";

export type SyncConnectionQuality = "excellent" | "good" | "slow" | "offline" | "reconnecting";

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
