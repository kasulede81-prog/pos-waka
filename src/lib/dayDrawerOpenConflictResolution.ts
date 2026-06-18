/**
 * Deterministic multi-device conflict resolution for DayDrawerOpen.
 * Priority: non-voided → newest updated_at → newest created_at → lexicographical id.
 */

import type { DayDrawerOpen } from "../types";

export type DayDrawerOpenConflictScore = [number, number, number, string];

export function dayDrawerOpenConflictScore(row: DayDrawerOpen): DayDrawerOpenConflictScore {
  const nonVoided = row.status === "voided" ? 0 : 1;
  const updatedMs = new Date(row.updatedAt).getTime();
  const createdMs = new Date(row.createdAt).getTime();
  return [nonVoided, Number.isNaN(updatedMs) ? 0 : updatedMs, Number.isNaN(createdMs) ? 0 : createdMs, row.id];
}

export function compareDayDrawerOpenWinner(a: DayDrawerOpen, b: DayDrawerOpen): DayDrawerOpen {
  const sa = dayDrawerOpenConflictScore(a);
  const sb = dayDrawerOpenConflictScore(b);
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return sa[i]! > sb[i]! ? a : b;
  }
  return a;
}

/** Ensure at most one active open per dateKey; demote duplicate actives to superseded. */
export function resolveDayDrawerOpenConflicts(rows: DayDrawerOpen[]): DayDrawerOpen[] {
  const byDate = new Map<string, DayDrawerOpen[]>();
  for (const row of rows) {
    if (row.deletedAt) continue;
    const list = byDate.get(row.dateKey) ?? [];
    list.push(row);
    byDate.set(row.dateKey, list);
  }

  const result: DayDrawerOpen[] = [];
  for (const dateRows of byDate.values()) {
    const active = dateRows.filter((r) => r.status === "open");
    if (active.length <= 1) {
      result.push(...dateRows);
      continue;
    }
    const winner = active.reduce((best, cur) => compareDayDrawerOpenWinner(best, cur));
    for (const row of dateRows) {
      if (row.status === "open" && row.id !== winner.id) {
        result.push({
          ...row,
          status: "superseded",
          updatedAt: row.updatedAt >= winner.updatedAt ? row.updatedAt : winner.updatedAt,
        });
      } else {
        result.push(row);
      }
    }
  }
  return result.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
