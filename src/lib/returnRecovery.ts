/**
 * Sale return cloud hydration — map DB rows to local records and merge on recovery.
 */

import type { ReturnReason, ReturnRecord } from "../types";

const RETURN_REASONS: ReturnReason[] = ["damaged", "warm_bad", "broken", "wrong_item", "other"];

export function normalizeReturnReason(raw: string): ReturnReason {
  return RETURN_REASONS.includes(raw as ReturnReason) ? (raw as ReturnReason) : "other";
}

export type CloudReturnRow = {
  record: ReturnRecord;
  updatedAt: string;
};

export function rowToReturnRecord(row: Record<string, unknown>): CloudReturnRow | null {
  const id = String(row.id ?? "").trim();
  const productId = String(row.product_id ?? "").trim();
  if (!id || !productId) return null;

  const meta =
    row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
  const saleIdRaw = row.sale_id != null ? String(row.sale_id).trim() : "";
  const createdAt = String(row.created_at ?? new Date().toISOString());
  const updatedAt = String(row.updated_at ?? createdAt);

  const record: ReturnRecord = {
    id,
    saleId: saleIdRaw.length > 0 ? saleIdRaw : null,
    productId,
    productName: String(meta.productName ?? ""),
    quantity: Math.max(0, Number(row.quantity ?? 0)),
    refundAmountUgx: Math.max(0, Math.floor(Number(row.refund_amount_ugx ?? 0))),
    cogsUgx: meta.cogsUgx != null ? Math.max(0, Math.floor(Number(meta.cogsUgx))) : undefined,
    unitCostUgx: meta.unitCostUgx != null ? Math.max(0, Number(meta.unitCostUgx)) : undefined,
    reason: normalizeReturnReason(String(row.reason ?? "other")),
    note: row.note != null ? String(row.note) : undefined,
    actorUserId: String(row.created_by ?? "unknown"),
    actorName: meta.actorName != null ? String(meta.actorName) : undefined,
    shiftId: meta.shiftId != null ? String(meta.shiftId) : null,
    createdAt,
  };

  if (record.refundAmountUgx <= 0 || record.quantity <= 0) return null;

  return { record, updatedAt };
}

function recencyMs(createdAt: string, updatedAt?: string): number {
  const u = updatedAt ? new Date(updatedAt).getTime() : Number.NaN;
  if (!Number.isNaN(u)) return u;
  const c = new Date(createdAt).getTime();
  return Number.isNaN(c) ? 0 : c;
}

/** Merge local and cloud return rows for device recovery (newer updatedAt wins). */
export function mergeReturnRecordsForRecovery(
  local: ReturnRecord[],
  remote: CloudReturnRow[],
): ReturnRecord[] {
  const map = new Map<string, { record: ReturnRecord; updatedAt: string }>();

  for (const r of local) {
    map.set(r.id, { record: r, updatedAt: r.createdAt });
  }

  for (const { record, updatedAt } of remote) {
    const existing = map.get(record.id);
    if (!existing) {
      map.set(record.id, { record, updatedAt });
      continue;
    }
    if (recencyMs(existing.record.createdAt, existing.updatedAt) <= recencyMs(record.createdAt, updatedAt)) {
      map.set(record.id, { record, updatedAt });
    }
  }

  return [...map.values()]
    .map((x) => x.record)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
