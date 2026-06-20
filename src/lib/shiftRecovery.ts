/**
 * Shift record merge — prefer closed shift with endAt; financial fields from more complete row.
 */

import type { ShiftRecord } from "../types";
import { recordSyncConflict } from "./syncConflictLog";

function shiftCompleteness(sh: ShiftRecord): number {
  let score = 0;
  if (sh.endAt) score += 10;
  if (sh.countedCashUgx != null) score += 5;
  if (sh.cashDifferenceUgx != null) score += 3;
  if (sh.handoffFloatUgx != null) score += 2;
  return score;
}

export function mergeShiftPair(local: ShiftRecord, remote: ShiftRecord): ShiftRecord {
  const localScore = shiftCompleteness(local);
  const remoteScore = shiftCompleteness(remote);

  if (localScore === remoteScore) {
    const localEnd = local.endAt ? Date.parse(local.endAt) : 0;
    const remoteEnd = remote.endAt ? Date.parse(remote.endAt) : 0;
    if (remoteEnd > localEnd) return { ...local, ...remote };
    if (localEnd > remoteEnd && local.pendingSync) {
      recordSyncConflict({
        domain: "shift",
        entityId: local.id,
        summary: `Shift ${local.actorName ?? local.actorUserId} concurrent close`,
        localUpdatedAt: local.endAt ?? local.startAt,
        remoteUpdatedAt: remote.endAt ?? remote.startAt,
        resolution: "kept_local",
      });
    }
    return local;
  }

  const winner = remoteScore > localScore ? remote : local;
  const loser = winner.id === local.id ? remote : local;
  if (local.pendingSync && loser.id === local.id) {
    recordSyncConflict({
      domain: "shift",
      entityId: local.id,
      summary: `Shift merge: local vs cloud completeness`,
      localUpdatedAt: local.endAt ?? local.startAt,
      remoteUpdatedAt: remote.endAt ?? remote.startAt,
      resolution: remoteScore > localScore ? "kept_remote" : "kept_local",
    });
  }
  return { ...loser, ...winner, pendingSync: winner.id === local.id && local.pendingSync };
}

export function mergeShiftsFromCloudPull(local: ShiftRecord[], cloud: ShiftRecord[]): ShiftRecord[] {
  if (cloud.length === 0) return local;
  const map = new Map(local.map((s) => [s.id, s]));
  for (const row of cloud) {
    const prev = map.get(row.id);
    map.set(row.id, prev ? mergeShiftPair(prev, row) : { ...row, pendingSync: false });
  }
  return [...map.values()].sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt));
}

export function parseShiftRows(rows: unknown[]): ShiftRecord[] {
  const out: ShiftRecord[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const payload = (r.payload ?? r.shift) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") continue;
    const id = String(payload.id ?? r.id ?? "");
    if (!id) continue;
    out.push({
      ...(payload as ShiftRecord),
      id,
      actorUserId: String(payload.actorUserId ?? r.actor_user_id ?? ""),
      startAt: String(payload.startAt ?? r.start_at ?? ""),
      endAt: payload.endAt != null ? String(payload.endAt) : r.end_at != null ? String(r.end_at) : null,
      pendingSync: false,
      updatedAt: String(r.updated_at ?? payload.updatedAt ?? payload.startAt ?? ""),
    });
  }
  return out;
}

export function shiftsFromPreferences(preferences: { shifts?: ShiftRecord[] }): ShiftRecord[] {
  return preferences.shifts ?? [];
}

export function preferencesWithMergedShifts(
  preferences: { shifts?: ShiftRecord[] },
  merged: ShiftRecord[],
): { shifts: ShiftRecord[] } {
  return { ...preferences, shifts: merged };
}
