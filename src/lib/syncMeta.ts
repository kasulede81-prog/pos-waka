/** Local-only sync health hints for owners (no PII). Account-scoped. */

import { getActiveAccountKey } from "../offline/accountScope";

const BASE_KEY = "waka.sync.health.v1";

function scopedKey(): string | null {
  const acc = getActiveAccountKey();
  if (!acc) return null;
  return `${BASE_KEY}::${acc}`;
}

export type SyncHealthMeta = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastPullAt: string | null;
  lastIssueAt: string | null;
  /** Friendly code for diagnostics UI */
  lastIssueCode: "none" | "partial" | "error";
  /** When device went offline (for trust indicators). */
  offlineSinceAt: string | null;
  /** Last time connectivity was confirmed. */
  lastOnlineAt: string | null;
  /** Queue health for owner diagnostics. */
  queueHealth: "healthy" | "degraded" | "backing_off";
};

const empty: SyncHealthMeta = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastPullAt: null,
  lastIssueAt: null,
  lastIssueCode: "none",
  offlineSinceAt: null,
  lastOnlineAt: null,
  queueHealth: "healthy",
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
      lastIssueAt: typeof o.lastIssueAt === "string" ? o.lastIssueAt : null,
      lastIssueCode: o.lastIssueCode === "partial" || o.lastIssueCode === "error" ? o.lastIssueCode : "none",
      offlineSinceAt: typeof o.offlineSinceAt === "string" ? o.offlineSinceAt : null,
      lastOnlineAt: typeof o.lastOnlineAt === "string" ? o.lastOnlineAt : null,
      queueHealth:
        o.queueHealth === "degraded" || o.queueHealth === "backing_off" ? o.queueHealth : "healthy",
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
