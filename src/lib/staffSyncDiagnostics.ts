/** Phase 25.1 — staff identity timeline diagnostics ([waka-staff]). Never log credentials. */

export type StaffSyncDiagnosticEvent =
  | "merge_applied"
  | "upsert_inserted"
  | "upsert_updated"
  | "duplicates_skipped"
  | "cache_mirror_merge"
  | "tombstones_applied"
  | "create_ack"
  | "update_ack"
  | "delete_ack"
  | "pin_reset_started"
  | "pin_reset_queued"
  | "pin_reset_retry"
  | "pin_reset_ack"
  | "propagation_latency"
  | "hydration"
  | "mirror"
  | "realtime"
  | "queue_depth";

const LOG_PREFIX = "[waka-staff]";

const SENSITIVE_KEYS = ["pin", "password", "hash", "secret", "token"];

let lastCreateLatencyMs: number | null = null;
let lastUpdateLatencyMs: number | null = null;
let lastDeleteLatencyMs: number | null = null;
let lastAckLatencyMs: number | null = null;
let lastRealtimeLatencyMs: number | null = null;
let lastHydrationDurationMs: number | null = null;
let lastMirrorDurationMs: number | null = null;
let lastCacheVersion: number | null = null;
let lastQueueDepth: number | null = null;
let lastRealtimeEventAt: number | null = null;
let lastPinResetAckLatencyMs: number | null = null;
let lastPinResetPropagationLatencyMs: number | null = null;

function sanitizeMeta(meta?: Record<string, string | number | boolean | null>): Record<string, unknown> {
  if (!meta) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lower.includes(s))) continue;
    safe[key] = value;
  }
  return safe;
}

function shouldLog(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return globalThis.localStorage?.getItem("waka.staff.log") === "1";
  } catch {
    return false;
  }
}

export function logStaffSyncEvent(
  event: StaffSyncDiagnosticEvent,
  meta?: Record<string, string | number | boolean | null>,
): void {
  if (shouldLog()) {
    console.info(LOG_PREFIX, { event, ...sanitizeMeta(meta) });
  }
}

export function recordStaffCreateLatency(ms: number): void {
  lastCreateLatencyMs = Math.round(ms);
  logStaffSyncEvent("create_ack", { durationMs: lastCreateLatencyMs });
}

export function recordStaffUpdateLatency(ms: number): void {
  lastUpdateLatencyMs = Math.round(ms);
  logStaffSyncEvent("update_ack", { durationMs: lastUpdateLatencyMs });
}

export function recordStaffDeleteLatency(ms: number): void {
  lastDeleteLatencyMs = Math.round(ms);
  logStaffSyncEvent("delete_ack", { durationMs: lastDeleteLatencyMs });
}

export function recordStaffAckLatency(ms: number, source?: string): void {
  lastAckLatencyMs = Math.round(ms);
  const event =
    source === "reset_secret" ? "pin_reset_ack" : source === "update" ? "update_ack" : "create_ack";
  logStaffSyncEvent(event, { durationMs: lastAckLatencyMs, source: source ?? "ack" });
}

export function logStaffPinResetStarted(staffId: string, field?: "pin" | "password" | "both"): void {
  logStaffSyncEvent("pin_reset_started", { staffId, field: field ?? "pin" });
}

export function logStaffPinResetQueued(staffId: string): void {
  logStaffSyncEvent("pin_reset_queued", { staffId });
}

export function recordStaffPinResetRetry(staffId: string, attempt?: number): void {
  logStaffSyncEvent("pin_reset_retry", { staffId, attempt: attempt ?? null });
}

export function recordStaffPinResetAckLatency(ms: number): void {
  lastPinResetAckLatencyMs = Math.round(ms);
  logStaffSyncEvent("pin_reset_ack", { durationMs: lastPinResetAckLatencyMs });
}

export function recordStaffPinResetPropagationLatency(ms: number): void {
  lastPinResetPropagationLatencyMs = Math.round(ms);
  logStaffSyncEvent("propagation_latency", { durationMs: lastPinResetPropagationLatencyMs, kind: "pin_reset" });
}

export function markStaffRealtimeEventReceived(): void {
  lastRealtimeEventAt = performance.now();
  logStaffSyncEvent("realtime", { received: true });
}

export function consumeStaffRealtimeToPullLatency(): number | null {
  if (lastRealtimeEventAt == null) return null;
  const ms = Math.round(performance.now() - lastRealtimeEventAt);
  lastRealtimeEventAt = null;
  lastRealtimeLatencyMs = ms;
  logStaffSyncEvent("realtime", { latencyMs: ms });
  return ms;
}

export function recordStaffHydrationDuration(ms: number, meta?: Record<string, string | number | boolean | null>): void {
  lastHydrationDurationMs = Math.round(ms);
  logStaffSyncEvent("hydration", { durationMs: lastHydrationDurationMs, ...meta });
}

export function recordStaffMirrorDuration(ms: number, meta?: Record<string, string | number | boolean | null>): void {
  lastMirrorDurationMs = Math.round(ms);
  logStaffSyncEvent("mirror", { durationMs: lastMirrorDurationMs, ...meta });
}

export function recordStaffCacheVersion(version: number): void {
  lastCacheVersion = version;
}

export function recordStaffQueueDepth(depth: number): void {
  lastQueueDepth = depth;
  logStaffSyncEvent("queue_depth", { depth });
}

export function readStaffSyncDiagnosticsSnapshot(): {
  lastCreateLatencyMs: number | null;
  lastUpdateLatencyMs: number | null;
  lastDeleteLatencyMs: number | null;
  lastAckLatencyMs: number | null;
  lastPinResetAckLatencyMs: number | null;
  lastPinResetPropagationLatencyMs: number | null;
  lastRealtimeLatencyMs: number | null;
  lastHydrationDurationMs: number | null;
  lastMirrorDurationMs: number | null;
  lastCacheVersion: number | null;
  lastQueueDepth: number | null;
} {
  return {
    lastCreateLatencyMs,
    lastUpdateLatencyMs,
    lastDeleteLatencyMs,
    lastAckLatencyMs,
    lastPinResetAckLatencyMs,
    lastPinResetPropagationLatencyMs,
    lastRealtimeLatencyMs,
    lastHydrationDurationMs,
    lastMirrorDurationMs,
    lastCacheVersion,
    lastQueueDepth,
  };
}

/** @deprecated Use logStaffSyncEvent — kept for existing call sites */
export const logStaffSyncEventLegacy = logStaffSyncEvent;
