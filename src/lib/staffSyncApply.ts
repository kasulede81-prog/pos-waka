/**
 * Phase 21.4 — merge-only staff application to store (never blind replace).
 */

import type { StaffAccount } from "../types";
import { sanitizeStaffForCache } from "./offlineStaffCache";
import {
  mergeStaffAccountsForCloudSync,
  pickNewerStaffAccount,
} from "./staffRecovery";
import { logStaffSyncEvent } from "./staffSyncDiagnostics";

export type StaffMergeApplyStats = {
  localCount: number;
  incomingCount: number;
  mergedCount: number;
  added: number;
  updated: number;
  preservedLocal: number;
  duplicatesSkipped: number;
};

function staffRowSignature(row: StaffAccount): string {
  return `${row.id}:${row.updatedAt}:${row.active}:${row.name}:${row.pendingCloudSync ? 1 : 0}`;
}

function staffListsEqual(a: StaffAccount[], b: StaffAccount[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].map(staffRowSignature).sort();
  const right = [...b].map(staffRowSignature).sort();
  return left.every((value, index) => value === right[index]);
}

/** Canonical unique staff list — newer row wins per ID. */
export function dedupeStaffAccountsById(accounts: StaffAccount[]): StaffAccount[] {
  const byId = new Map<string, StaffAccount>();
  let duplicatesSkipped = 0;

  for (const row of accounts) {
    const id = row.id?.trim();
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, row);
      continue;
    }
    duplicatesSkipped += 1;
    byId.set(id, pickNewerStaffAccount(existing, row));
  }

  if (duplicatesSkipped > 0) {
    logStaffSyncEvent("duplicates_skipped", { count: duplicatesSkipped });
  }

  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Merge local + incoming, then dedupe by staff ID. */
export function mergeStaffAccountsWithDedupe(
  local: StaffAccount[],
  incoming: StaffAccount[],
): StaffAccount[] {
  const merged = mergeStaffAccountsForCloudSync(local, incoming);
  return dedupeStaffAccountsById(merged);
}

export function computeStaffMergeStats(
  local: StaffAccount[],
  incoming: StaffAccount[],
  merged: StaffAccount[],
): StaffMergeApplyStats {
  const localIds = new Set(local.map((s) => s.id));
  const incomingIds = new Set(incoming.map((s) => s.id));
  let added = 0;
  let updated = 0;
  for (const id of incomingIds) {
    if (!localIds.has(id)) added += 1;
    else updated += 1;
  }
  const preservedLocal = merged.filter((s) => localIds.has(s.id) && !incomingIds.has(s.id)).length;
  const duplicatesSkipped = Math.max(0, local.length + incoming.length - new Set(merged.map((s) => s.id)).size);

  return {
    localCount: local.length,
    incomingCount: incoming.length,
    mergedCount: merged.length,
    added,
    updated,
    preservedLocal,
    duplicatesSkipped,
  };
}

/**
 * Merge incoming cloud/cache rows into preferences.staffAccounts.
 * Never replaces the full array without merging with local state.
 */
export async function applyStaffAccountsMergeToStore(
  incoming: StaffAccount[],
  opts?: { sanitize?: boolean; source?: string },
): Promise<StaffMergeApplyStats> {
  const { usePosStore } = await import("../store/usePosStore");
  const state = usePosStore.getState();
  const local = state.preferences.staffAccounts ?? [];
  const cloudRows = opts?.sanitize === false ? incoming : sanitizeStaffForCache(incoming);
  const merged = mergeStaffAccountsWithDedupe(local, cloudRows);
  const stats = computeStaffMergeStats(local, cloudRows, merged);

  logStaffSyncEvent("merge_applied", {
    source: opts?.source ?? "unknown",
    cloudRows: stats.incomingCount,
    merged: stats.mergedCount,
    added: stats.added,
    updated: stats.updated,
    preservedLocal: stats.preservedLocal,
    skippedDuplicates: stats.duplicatesSkipped,
  });

  if (!staffListsEqual(local, merged)) {
    usePosStore.setState({
      preferences: {
        ...state.preferences,
        staffAccounts: merged,
      },
    });
  }

  return stats;
}

/**
 * Upsert a single staff row — insert if missing, merge if present (never duplicate ID).
 */
export async function upsertStaffAccountInStore(row: StaffAccount): Promise<boolean> {
  const { usePosStore } = await import("../store/usePosStore");
  const state = usePosStore.getState();
  const accounts = state.preferences.staffAccounts ?? [];
  const existing = accounts.find((a) => a.id === row.id);

  if (existing) {
    const next = pickNewerStaffAccount(existing, { ...row, pendingCloudSync: false });
    if (staffRowSignature(existing) === staffRowSignature(next)) return false;
    usePosStore.setState({
      preferences: {
        ...state.preferences,
        staffAccounts: accounts.map((a) => (a.id === row.id ? next : a)),
      },
    });
    logStaffSyncEvent("upsert_updated", { staffId: row.id });
    return true;
  }

  usePosStore.setState({
    preferences: {
      ...state.preferences,
      staffAccounts: dedupeStaffAccountsById([row, ...accounts]),
    },
  });
  logStaffSyncEvent("upsert_inserted", { staffId: row.id });
  return true;
}
