/**
 * Day close merge — active close per date; superseded rows preserved.
 */

import type { DayCloseSummary } from "../types";
import { recordSyncConflict } from "./syncConflictLog";

export function mergeDayClosePair(local: DayCloseSummary, remote: DayCloseSummary): DayCloseSummary {
  const localAt = Date.parse(local.updatedAt ?? local.createdAt) || 0;
  const remoteAt = Date.parse(remote.updatedAt ?? remote.createdAt) || 0;
  const localActive = !local.supersededAt;
  const remoteActive = !remote.supersededAt;

  if (localActive && remoteActive && local.id !== remote.id) {
    recordSyncConflict({
      domain: "day_close",
      entityId: local.dateKey,
      summary: `Duplicate active day close for ${local.dateKey}`,
      localUpdatedAt: local.createdAt,
      remoteUpdatedAt: remote.createdAt,
      resolution: remoteAt >= localAt ? "kept_remote" : "kept_local",
    });
    return remoteAt >= localAt ? { ...remote, pendingSync: false } : local;
  }

  if (remoteAt > localAt) {
    return { ...local, ...remote, pendingSync: false };
  }
  return local;
}

export function mergeDayClosesFromCloudPull(local: DayCloseSummary[], cloud: DayCloseSummary[]): DayCloseSummary[] {
  if (cloud.length === 0) return local;
  const map = new Map(local.map((d) => [d.id, d]));
  for (const row of cloud) {
    const prev = map.get(row.id);
    map.set(row.id, prev ? mergeDayClosePair(prev, row) : { ...row, pendingSync: false });
  }
  return [...map.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function parseDayCloseRows(rows: unknown[]): DayCloseSummary[] {
  const out: DayCloseSummary[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const payload = (r.payload ?? r.close) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") continue;
    const id = String(payload.id ?? r.id ?? "");
    if (!id) continue;
    out.push({
      ...(payload as DayCloseSummary),
      id,
      dateKey: String(payload.dateKey ?? r.date_key ?? ""),
      supersededAt: payload.supersededAt != null ? String(payload.supersededAt) : r.superseded_at != null ? String(r.superseded_at) : null,
      pendingSync: false,
      updatedAt: String(r.updated_at ?? payload.updatedAt ?? payload.createdAt ?? ""),
    });
  }
  return out;
}
