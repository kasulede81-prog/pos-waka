/**
 * Local sync conflict log — surfaced in Conflict Center (not silent overwrites).
 */

export type SyncConflictDomain =
  | "inventory_count"
  | "shift"
  | "day_close"
  | "day_open"
  | "stock"
  | "sale";

export type SyncConflictResolution = "kept_local" | "kept_remote" | "merged";

export type SyncConflictEntry = {
  id: string;
  at: string;
  domain: SyncConflictDomain;
  entityId: string;
  summary: string;
  localUpdatedAt?: string | null;
  remoteUpdatedAt?: string | null;
  resolution: SyncConflictResolution;
  acknowledged?: boolean;
};

const MAX_ENTRIES = 200;
const STORAGE_KEY = "waka.sync.conflicts.v1";

function readAll(): SyncConflictEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SyncConflictEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: SyncConflictEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* quota */
  }
}

export function recordSyncConflict(
  entry: Omit<SyncConflictEntry, "id" | "at" | "acknowledged">,
): void {
  const row: SyncConflictEntry = {
    ...entry,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    acknowledged: false,
  };
  const all = readAll();
  writeAll([row, ...all]);
}

export function listSyncConflicts(opts?: { unacknowledgedOnly?: boolean }): SyncConflictEntry[] {
  const all = readAll();
  if (opts?.unacknowledgedOnly) return all.filter((e) => !e.acknowledged);
  return all;
}

export function acknowledgeSyncConflict(id: string): void {
  writeAll(readAll().map((e) => (e.id === id ? { ...e, acknowledged: true } : e)));
}

export function clearAcknowledgedSyncConflicts(): void {
  writeAll(readAll().filter((e) => !e.acknowledged));
}
