/**
 * Inventory count session merge — status-rank authority with line-level LWW.
 */

import type { InventoryCountLine, InventoryCountSession, InventoryCountSessionStatus } from "../types";
import { normalizeInventoryCountSession } from "./inventoryCount";
import { recordSyncConflict } from "./syncConflictLog";

const STATUS_RANK: Record<InventoryCountSessionStatus, number> = {
  draft: 0,
  counting: 1,
  submitted: 2,
  approved: 3,
  applied: 4,
  cancelled: -2,
};

function lineRank(status: InventoryCountSessionStatus): number {
  return STATUS_RANK[status] ?? 0;
}

function mergeInventoryCountLine(local: InventoryCountLine, remote: InventoryCountLine): InventoryCountLine {
  const localAt = Date.parse(local.updatedAt) || 0;
  const remoteAt = Date.parse(remote.updatedAt) || 0;
  return remoteAt >= localAt ? remote : local;
}

function mergeInventoryCountLines(local: InventoryCountLine[], remote: InventoryCountLine[]): InventoryCountLine[] {
  const map = new Map(local.map((l) => [l.productId, l]));
  for (const r of remote) {
    const prev = map.get(r.productId);
    map.set(r.productId, prev ? mergeInventoryCountLine(prev, r) : r);
  }
  return [...map.values()];
}

export function mergeInventoryCountSessionPair(
  local: InventoryCountSession,
  remote: InventoryCountSession,
): InventoryCountSession {
  const localRank = lineRank(local.status);
  const remoteRank = lineRank(remote.status);

  if (localRank === remoteRank) {
    const localAt = Date.parse(local.updatedAt) || 0;
    const remoteAt = Date.parse(remote.updatedAt) || 0;
    if (remoteAt > localAt) {
      return normalizeInventoryCountSession({
        ...remote,
        lines: mergeInventoryCountLines(local.lines, remote.lines),
        pendingSync: false,
      });
    }
    if (localAt > remoteAt && local.pendingSync) {
      recordSyncConflict({
        domain: "inventory_count",
        entityId: local.id,
        summary: `Inventory count #${local.sessionNumber} concurrent edit`,
        localUpdatedAt: local.updatedAt,
        remoteUpdatedAt: remote.updatedAt,
        resolution: "kept_local",
      });
    }
    return normalizeInventoryCountSession({
      ...local,
      lines: mergeInventoryCountLines(local.lines, remote.lines),
    });
  }

  const winner = remoteRank > localRank ? remote : local;
  const loser = winner.id === local.id ? remote : local;

  if (localRank !== remoteRank && local.pendingSync && loser.id === local.id) {
    recordSyncConflict({
      domain: "inventory_count",
      entityId: local.id,
      summary: `Inventory count #${local.sessionNumber}: ${local.status} vs cloud ${remote.status}`,
      localUpdatedAt: local.updatedAt,
      remoteUpdatedAt: remote.updatedAt,
      resolution: remoteRank > localRank ? "kept_remote" : "kept_local",
    });
  }

  return normalizeInventoryCountSession({
    ...loser,
    ...winner,
    lines: mergeInventoryCountLines(local.lines, remote.lines),
    pendingSync: remoteRank > localRank ? false : Boolean(local.pendingSync),
  });
}

export function mergeInventoryCountSessionsFromCloudPull(
  local: InventoryCountSession[],
  cloud: InventoryCountSession[],
): InventoryCountSession[] {
  if (cloud.length === 0) return local;
  const map = new Map(local.map((s) => [s.id, s]));
  for (const row of cloud) {
    const prev = map.get(row.id);
    map.set(row.id, prev ? mergeInventoryCountSessionPair(prev, row) : normalizeInventoryCountSession({ ...row, pendingSync: false }));
  }
  return [...map.values()].sort((a, b) => b.sessionNumber - a.sessionNumber);
}

export function parseInventoryCountSessionRows(rows: unknown[]): InventoryCountSession[] {
  const out: InventoryCountSession[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const payload = (r.payload ?? r.session) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") continue;
    const id = String(payload.id ?? r.id ?? "");
    if (!id) continue;
    try {
      out.push(
        normalizeInventoryCountSession({
          ...(payload as InventoryCountSession),
          id,
          sessionNumber: Number(payload.sessionNumber ?? r.session_number ?? 0),
          status: (payload.status ?? r.status) as InventoryCountSessionStatus,
          pendingSync: false,
          updatedAt: String(r.updated_at ?? payload.updatedAt ?? new Date().toISOString()),
        }),
      );
    } catch {
      /* skip malformed */
    }
  }
  return out;
}
