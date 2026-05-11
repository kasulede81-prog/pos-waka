/** Local-only sync health hints for owners (no PII). */

const KEY = "waka.sync.health.v1";

export type SyncHealthMeta = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastIssueAt: string | null;
  /** Friendly code for diagnostics UI */
  lastIssueCode: "none" | "partial" | "error";
};

const empty: SyncHealthMeta = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastIssueAt: null,
  lastIssueCode: "none",
};

export function readSyncHealthMeta(): SyncHealthMeta {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...empty };
    const o = JSON.parse(raw) as Partial<SyncHealthMeta>;
    return {
      lastAttemptAt: typeof o.lastAttemptAt === "string" ? o.lastAttemptAt : null,
      lastSuccessAt: typeof o.lastSuccessAt === "string" ? o.lastSuccessAt : null,
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
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}
