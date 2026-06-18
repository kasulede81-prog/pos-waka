import type { CashDrawerAdjustment } from "../types";
import { normalizeCashDrawerAdjustment } from "./cashDrawerLedger";

export function parseCashDrawerAdjustmentRows(rows: unknown[]): CashDrawerAdjustment[] {
  const out: CashDrawerAdjustment[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = String(r.id ?? "");
    const type = String(r.type ?? r.adjustment_type ?? "");
    if (!id || !type) continue;
    out.push(
      normalizeCashDrawerAdjustment({
        id,
        type: type as CashDrawerAdjustment["type"],
        amountUgx: Number(r.amount_ugx ?? r.amountUgx ?? 0),
        note: String(r.note ?? ""),
        actorUserId: String(r.actor_user_id ?? r.actorUserId ?? "unknown"),
        actorName: r.actor_name ? String(r.actor_name) : r.actorName ? String(r.actorName) : undefined,
        occurredAt: String(r.occurred_at ?? r.occurredAt ?? new Date().toISOString()),
        createdAt: String(r.created_at ?? r.createdAt ?? new Date().toISOString()),
        updatedAt: String(r.updated_at ?? r.updatedAt ?? new Date().toISOString()),
        syncedAt: r.synced_at ? String(r.synced_at) : null,
        pendingSync: false,
        deletedAt: r.deleted_at ? String(r.deleted_at) : null,
      }),
    );
  }
  return out;
}

export async function mergeCashDrawerAdjustmentsFromCloudPull(
  local: CashDrawerAdjustment[],
  cloud: CashDrawerAdjustment[],
): Promise<CashDrawerAdjustment[]> {
  if (cloud.length === 0) return local;
  const map = new Map(local.map((a) => [a.id, a]));
  for (const row of cloud) {
    const prev = map.get(row.id);
    if (!prev || new Date(row.updatedAt).getTime() >= new Date(prev.updatedAt).getTime()) {
      map.set(row.id, row);
    }
  }
  return [...map.values()].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
}
