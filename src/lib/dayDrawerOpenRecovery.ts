import type { DayDrawerOpen, DayDrawerOpenStatus } from "../types";
import { normalizeDayDrawerOpen } from "./dayDrawerOpen";
import {
  compareDayDrawerOpenWinner,
  resolveDayDrawerOpenConflicts,
} from "./dayDrawerOpenConflictResolution";

export function parseDayDrawerOpenRows(rows: unknown[]): DayDrawerOpen[] {
  const out: DayDrawerOpen[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = String(r.id ?? "");
    const dateKey = String(r.date_key ?? r.dateKey ?? "");
    if (!id || !dateKey) continue;
    const status = String(r.status ?? "open") as DayDrawerOpenStatus;
    out.push(
      normalizeDayDrawerOpen({
        id,
        dateKey,
        openingFloatUgx: Number(r.opening_float_ugx ?? r.openingFloatUgx ?? 0),
        countedAt: String(r.counted_at ?? r.countedAt ?? r.created_at ?? new Date().toISOString()),
        countedByUserId: String(r.created_by ?? r.countedByUserId ?? "unknown"),
        countedByLabel: String(r.counted_by_label ?? r.countedByLabel ?? r.created_by ?? "unknown"),
        note: String(r.note ?? ""),
        deviceId: String(r.device_id ?? r.deviceId ?? ""),
        status,
        supersedesId: r.supersedes_id ? String(r.supersedes_id) : r.supersedesId ? String(r.supersedesId) : null,
        voidReason: r.void_reason ? String(r.void_reason) : r.voidReason ? String(r.voidReason) : null,
        createdAt: String(r.created_at ?? r.createdAt ?? new Date().toISOString()),
        updatedAt: String(r.updated_at ?? r.updatedAt ?? new Date().toISOString()),
        pendingSync: false,
        cloudSyncedAt: String(r.updated_at ?? r.updatedAt ?? new Date().toISOString()),
        lastSyncError: null,
        deletedAt: null,
      }),
    );
  }
  return out;
}

export function mergeDayDrawerOpenPair(local: DayDrawerOpen, cloud: DayDrawerOpen): DayDrawerOpen {
  if (local.status === "voided") {
    return normalizeDayDrawerOpen({
      ...local,
      cloudSyncedAt: cloud.status === "voided" ? cloud.updatedAt : local.cloudSyncedAt,
      pendingSync: cloud.status === "voided" ? false : local.pendingSync,
      lastSyncError: cloud.status !== "voided" ? local.lastSyncError : null,
    });
  }

  const winner = compareDayDrawerOpenWinner(local, cloud);
  const loser = winner.id === local.id ? cloud : local;
  const fromCloud = winner.id === cloud.id;

  return normalizeDayDrawerOpen({
    ...loser,
    ...winner,
    firstVerifiedByUserId: local.firstVerifiedByUserId ?? cloud.firstVerifiedByUserId,
    firstVerifiedByLabel: local.firstVerifiedByLabel ?? cloud.firstVerifiedByLabel,
    witnessUserId: local.witnessUserId ?? cloud.witnessUserId,
    pendingSync: fromCloud ? false : local.pendingSync,
    cloudSyncedAt: fromCloud ? cloud.updatedAt : local.cloudSyncedAt ?? null,
    lastSyncError: fromCloud ? null : local.lastSyncError,
  });
}

export async function mergeDayDrawerOpensFromCloudPull(
  local: DayDrawerOpen[],
  cloud: DayDrawerOpen[],
): Promise<DayDrawerOpen[]> {
  if (cloud.length === 0) return local;
  const map = new Map(local.map((r) => [r.id, r]));
  for (const cloudRow of cloud) {
    const prev = map.get(cloudRow.id);
    if (!prev) {
      map.set(cloudRow.id, normalizeDayDrawerOpen({ ...cloudRow, pendingSync: false, cloudSyncedAt: cloudRow.updatedAt }));
    } else {
      map.set(cloudRow.id, mergeDayDrawerOpenPair(prev, cloudRow));
    }
  }
  return resolveDayDrawerOpenConflicts([...map.values()]);
}
