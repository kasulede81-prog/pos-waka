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
};

const empty: SyncHealthMeta = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastPullAt: null,
  lastIssueAt: null,
  lastIssueCode: "none",
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
