/** Local-only sync health hints for owners (no PII). Account-scoped. */

import { getActiveShopId, getPersistenceNamespace, isValidShopId } from "../offline/shopScope";
import { reportSwallowedSyncFailure } from "./monitoring";
import { hasSupabaseConfig, supabase } from "./supabase";

const BASE_KEY = "waka.sync.health.v1";

function scopedKey(): string | null {
  const ns = getPersistenceNamespace();
  if (!ns) return null;
  return `${BASE_KEY}::${ns}`;
}

export type SyncHealthMeta = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastPullAt: string | null;
  lastPushAt: string | null;
  lastIssueAt: string | null;
  /** Friendly code for diagnostics UI */
  lastIssueCode: "none" | "partial" | "error";
  /** When device went offline (for trust indicators). */
  offlineSinceAt: string | null;
  /** Last time connectivity was confirmed. */
  lastOnlineAt: string | null;
  /** Queue health for owner diagnostics. */
  queueHealth: "healthy" | "degraded" | "backing_off" | "blocked" | "quarantined";
  /** WAKA-12 — last pull entity failures. Empty when the last pull was complete. */
  entityPullErrors?: Record<string, string>;
  /** POS push-only upload diagnostics (no cloud pull). */
  posPushAttempts?: number;
  posPushSuccesses?: number;
  posPushFailures?: number;
  lastPosPushAt?: string | null;
  lastPosPushSuccessAt?: string | null;
  lastPosPushSkipReason?: string | null;
  posPushUploadActive?: boolean;
};

const empty: SyncHealthMeta = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastPullAt: null,
  lastPushAt: null,
  lastIssueAt: null,
  lastIssueCode: "none",
  offlineSinceAt: null,
  lastOnlineAt: null,
  queueHealth: "healthy",
  posPushAttempts: 0,
  posPushSuccesses: 0,
  posPushFailures: 0,
  lastPosPushAt: null,
  lastPosPushSuccessAt: null,
  lastPosPushSkipReason: null,
  posPushUploadActive: false,
  entityPullErrors: {},
};

export function readSyncHealthMeta(): SyncHealthMeta {
  try {
    const k = scopedKey();
    if (!k) return { ...empty };
    const raw = localStorage.getItem(k);
    if (!raw) return { ...empty };
    const o = JSON.parse(raw) as Partial<SyncHealthMeta>;
    return {
      lastAttemptAt: typeof o.lastAttemptAt === "string" ? o.lastAttemptAt : null,
      lastSuccessAt: typeof o.lastSuccessAt === "string" ? o.lastSuccessAt : null,
      lastPullAt: typeof o.lastPullAt === "string" ? o.lastPullAt : null,
      lastPushAt: typeof o.lastPushAt === "string" ? o.lastPushAt : null,
      lastIssueAt: typeof o.lastIssueAt === "string" ? o.lastIssueAt : null,
      lastIssueCode: o.lastIssueCode === "partial" || o.lastIssueCode === "error" ? o.lastIssueCode : "none",
      offlineSinceAt: typeof o.offlineSinceAt === "string" ? o.offlineSinceAt : null,
      lastOnlineAt: typeof o.lastOnlineAt === "string" ? o.lastOnlineAt : null,
      queueHealth:
        o.queueHealth === "degraded" ||
        o.queueHealth === "backing_off" ||
        o.queueHealth === "blocked" ||
        o.queueHealth === "quarantined"
          ? o.queueHealth
          : "healthy",
      entityPullErrors:
        o.entityPullErrors && typeof o.entityPullErrors === "object" && !Array.isArray(o.entityPullErrors)
          ? Object.fromEntries(
              Object.entries(o.entityPullErrors).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            )
          : {},
      posPushAttempts: typeof o.posPushAttempts === "number" ? o.posPushAttempts : 0,
      posPushSuccesses: typeof o.posPushSuccesses === "number" ? o.posPushSuccesses : 0,
      posPushFailures: typeof o.posPushFailures === "number" ? o.posPushFailures : 0,
      lastPosPushAt: typeof o.lastPosPushAt === "string" ? o.lastPosPushAt : null,
      lastPosPushSuccessAt: typeof o.lastPosPushSuccessAt === "string" ? o.lastPosPushSuccessAt : null,
      lastPosPushSkipReason: typeof o.lastPosPushSkipReason === "string" ? o.lastPosPushSkipReason : null,
      posPushUploadActive: o.posPushUploadActive === true,
    };
  } catch {
    return { ...empty };
  }
}

export function writeSyncHealthMeta(partial: Partial<SyncHealthMeta>): SyncHealthMeta {
  const next = { ...readSyncHealthMeta(), ...partial };
  try {
    const k = scopedKey();
    if (!k) return next;
    localStorage.setItem(k, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

/**
 * WAKA-12 — one place that decides whether a cycle may claim full health.
 * A successful push must not clear a failed pull, and an empty in-memory view
 * must not claim healthy while durable queue rows remain.
 */
export function applySyncHealthAfterCycle(input: {
  attemptAt: string;
  pullPartial: boolean;
  entityPullErrors?: Record<string, string>;
  pushFail: number;
  queueFailed: number;
  durableRemaining: number;
  queueHealth: SyncHealthMeta["queueHealth"];
}): SyncHealthMeta {
  const errors = input.entityPullErrors ?? {};
  const pullOrPushIssue =
    input.pullPartial ||
    Object.keys(errors).length > 0 ||
    input.pushFail > 0 ||
    input.queueFailed > 0;
  if (!pullOrPushIssue && input.durableRemaining === 0) {
    return writeSyncHealthMeta({
      lastSuccessAt: input.attemptAt,
      lastIssueCode: "none",
      lastIssueAt: null,
      queueHealth: "healthy",
      entityPullErrors: {},
    });
  }
  const blocked = input.queueHealth === "quarantined" || input.queueHealth === "blocked";
  if (pullOrPushIssue || blocked) {
    return writeSyncHealthMeta({
      lastIssueAt: input.attemptAt,
      lastIssueCode: "partial",
      queueHealth: input.queueHealth,
      entityPullErrors: errors,
    });
  }
  return writeSyncHealthMeta({
    queueHealth: input.queueHealth,
    entityPullErrors: errors,
  });
}

/** Human-readable offline duration for trust UI. */
export function offlineDurationLabel(offlineSinceAt: string | null, nowMs = Date.now()): string | null {
  if (!offlineSinceAt) return null;
  const start = new Date(offlineSinceAt).getTime();
  if (!Number.isFinite(start)) return null;
  const mins = Math.max(0, Math.floor((nowMs - start) / 60_000));
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export type ShopSyncHealthPublishInput = {
  shopId?: string | null;
  pendingOutbound?: number;
  includePendingOutbound?: boolean;
  lastPullAt?: string;
  lastPushOkAt?: string;
  lastError?: string | null;
  includeLastError?: boolean;
  includeLastPushOkAt?: boolean;
};

/**
 * Durable queue is the owner-facing pending count. Unsynced sales are a second
 * pending signal used to trigger flushes. Checkout is typically in both.
 * Use the queue when it is non-empty; fall back to unsynced sales only when
 * the queue would otherwise false-zero.
 */
export function countPendingOutboundFromKnown(durableQueueLength: number, unsyncedSales: number): number {
  const queue = Number.isFinite(durableQueueLength) ? Math.max(0, Math.floor(durableQueueLength)) : 0;
  const unsynced = Number.isFinite(unsyncedSales) ? Math.max(0, Math.floor(unsyncedSales)) : 0;
  if (queue > 0) return queue;
  return unsynced;
}

export function formatCloudSyncLastError(
  meta: Pick<SyncHealthMeta, "lastIssueCode" | "entityPullErrors">,
): string | null {
  if (meta.lastIssueCode === "none") return null;
  const entries = Object.entries(meta.entityPullErrors ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0,
  );
  if (entries.length === 0) return meta.lastIssueCode;
  const detail = entries
    .slice(0, 6)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return `${meta.lastIssueCode}:${detail}`;
}

export function shouldAdvanceLastPushOkAt(input: {
  pushFail: number;
  queueFailed: number;
  skipped?: boolean;
  queueHealth?: SyncHealthMeta["queueHealth"];
  /** Successful pendingSync-scan uploads from pushAllPendingToCloud. */
  pushOk?: number;
  /** Durable queue shrank during this flush (ops ACKed / removed). */
  hadOutboundWork?: boolean;
}): boolean {
  if (input.skipped) return false;
  if (input.pushFail !== 0 || input.queueFailed !== 0) return false;
  if (input.queueHealth === "quarantined" || input.queueHealth === "blocked") return false;
  const uploaded = (typeof input.pushOk === "number" && input.pushOk > 0) || input.hadOutboundWork === true;
  return uploaded;
}

/** Explicit shop_id wins when valid; never substitute a different shop. */
export function resolveShopSyncHealthShopId(explicit?: string | null): string | null {
  if (explicit != null && String(explicit).trim() !== "") {
    const trimmed = String(explicit).trim();
    return isValidShopId(trimmed) ? trimmed : null;
  }
  const active = getActiveShopId();
  return active && isValidShopId(active) ? active : null;
}

export function buildShopSyncHealthUpsertRow(
  input: ShopSyncHealthPublishInput & { shopId: string; pendingOutbound?: number; updatedAt: string },
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    shop_id: input.shopId,
    updated_at: input.updatedAt,
  };
  if (input.includePendingOutbound !== false) {
    row.pending_outbound = Math.max(0, Math.floor(input.pendingOutbound ?? 0) || 0);
  }
  if (typeof input.lastPullAt === "string" && input.lastPullAt.trim()) {
    row.last_pull_at = input.lastPullAt;
  }
  if (input.includeLastPushOkAt === true && typeof input.lastPushOkAt === "string" && input.lastPushOkAt.trim()) {
    row.last_push_ok_at = input.lastPushOkAt;
  }
  if (input.includeLastError === true) {
    row.last_error = input.lastError ?? null;
  }
  return row;
}

async function readPendingOutboundCount(explicit?: number): Promise<number> {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
    return Math.floor(explicit);
  }
  const { readSyncQueue } = await import("../offline/localDb");
  const queueLen = (await readSyncQueue()).length;
  if (queueLen > 0) return queueLen;
  const { countUnsyncedSales } = await import("../offline/cloudSync");
  return countUnsyncedSales();
}

/**
 * Fire-and-forget cloud `sync_health` upsert. Telemetry failure must never
 * throw into sale, queue, or sync business paths.
 */
export function publishShopSyncHealth(input: ShopSyncHealthPublishInput): void {
  try {
    void publishShopSyncHealthInner(input).catch(() => undefined);
  } catch {
    /* telemetry must never throw */
  }
}

async function publishShopSyncHealthInner(input: ShopSyncHealthPublishInput): Promise<void> {
  if (!hasSupabaseConfig || !supabase) return;
  const shopId = resolveShopSyncHealthShopId(input.shopId);
  if (!shopId) return;
  const includePendingOutbound = input.includePendingOutbound !== false;
  const pendingOutbound = includePendingOutbound ? await readPendingOutboundCount(input.pendingOutbound) : undefined;
  const row = buildShopSyncHealthUpsertRow({
    ...input,
    shopId,
    pendingOutbound,
    includePendingOutbound,
    updatedAt: new Date().toISOString(),
  });
  await supabase.from("sync_health").upsert(row, { onConflict: "shop_id" });
}

export function publishShopSyncHealthAfterPushCycle(input: {
  shopId?: string | null;
  pendingOutbound?: number;
  pushFail: number;
  queueFailed: number;
  skipped?: boolean;
  queueHealth?: SyncHealthMeta["queueHealth"];
  lastPushOkAt?: string;
  lastError?: string | null;
  includeLastError?: boolean;
  backgroundError?: boolean;
  pushOk?: number;
  hadOutboundWork?: boolean;
}): void {
  if (input.skipped) return;
  if (input.backgroundError) {
    publishShopSyncHealth({
      shopId: input.shopId,
      pendingOutbound: input.pendingOutbound,
      lastError: "error",
      includeLastError: true,
    });
    return;
  }
  const advance = shouldAdvanceLastPushOkAt({
    pushFail: input.pushFail,
    queueFailed: input.queueFailed,
    queueHealth: input.queueHealth,
    pushOk: input.pushOk,
    hadOutboundWork: input.hadOutboundWork,
  });
  let lastError = input.lastError;
  if (
    !advance &&
    (input.queueHealth === "quarantined" || input.queueHealth === "blocked") &&
    (lastError == null || lastError === "")
  ) {
    lastError = "partial";
  }
  publishShopSyncHealth({
    shopId: input.shopId,
    pendingOutbound: input.pendingOutbound,
    lastError: input.includeLastError === false ? undefined : lastError,
    includeLastError: input.includeLastError !== false,
    lastPushOkAt: advance ? input.lastPushOkAt ?? new Date().toISOString() : undefined,
    includeLastPushOkAt: advance,
  });
}

/**
 * R6 — fire-and-forget sync/push threw before WAKA-12's cycle health writer ran.
 * Keep lastIssueCode distinct from a clean success without adding a new UI event.
 */
export function recordBackgroundSyncFailure(code: string, err?: unknown): SyncHealthMeta {
  reportSwallowedSyncFailure(code, err);
  const at = new Date().toISOString();
  const meta = writeSyncHealthMeta({
    lastAttemptAt: at,
    lastIssueAt: at,
    lastIssueCode: "error",
  });
  publishShopSyncHealth({
    lastError: "error",
    includeLastError: true,
  });
  return meta;
}
