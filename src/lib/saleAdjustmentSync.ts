/**
 * Sale-adjustment outbox — Return/Void are durable operations, not sale re-completion.
 * SALE_CLOUD_ACKED is the existing sale.pendingSync flag. No new sale field.
 */

import type { SyncOperation } from "../types";

export const WAITING_FOR_SALE_ERROR = "waiting_for_sale";
export const SALE_ADJUSTMENT_RETURN = "return";
export const SALE_ADJUSTMENT_VOID = "void";

export type SyncProcessResult = "ack" | "retry" | "wait" | "park";
export type SaleAdjustmentOperationType = typeof SALE_ADJUSTMENT_RETURN | typeof SALE_ADJUSTMENT_VOID;

export function isWaitingForSaleSyncError(error?: string | null): boolean {
  return error === WAITING_FOR_SALE_ERROR;
}

/** Completed sale with pendingSync !== true has finished cloud sale synchronization. */
export function isSaleCloudAcked(sale: { pendingSync?: boolean | null } | null | undefined): boolean {
  return Boolean(sale) && sale!.pendingSync !== true;
}

export function linkedSaleAdjustmentDecision(
  sale: { pendingSync?: boolean | null } | null | undefined,
  saleId: string | null | undefined,
): "proceed" | "wait" {
  const id = typeof saleId === "string" ? saleId.trim() : "";
  if (!id) return "proceed";
  return isSaleCloudAcked(sale) ? "proceed" : "wait";
}

/** Retain the queue row without treating WAIT as a failed network attempt. */
export function markSyncOpWaitingForSale(op: SyncOperation): SyncOperation {
  return {
    ...op,
    lastError: WAITING_FOR_SALE_ERROR,
  };
}

export function isSaleCompletionQueueKind(kind: SyncOperation["kind"]): boolean {
  return kind === "pending_sales" || kind === "sale";
}

export function partitionSaleBeforeAdjustment<T extends { kind: SyncOperation["kind"] }>(
  ready: readonly T[],
): { saleUploads: T[]; other: T[] } {
  const saleUploads: T[] = [];
  const other: T[] = [];
  for (const op of ready) {
    if (isSaleCompletionQueueKind(op.kind)) saleUploads.push(op);
    else other.push(op);
  }
  return { saleUploads, other };
}

/** Queue row id is the durable return/void record id so replay upserts the same outbox row. */
export function saleAdjustmentQueueId(recordId: string): string {
  return String(recordId ?? "").trim();
}

export function saleAdjustmentOutboxMeta(input: {
  operationType: SaleAdjustmentOperationType;
  saleId?: string | null;
  dateKey?: string | null;
}): { operationType: SaleAdjustmentOperationType; saleId: string | null; dateKey: string | null } {
  const saleId = typeof input.saleId === "string" && input.saleId.trim() ? input.saleId.trim() : null;
  const dateKey = typeof input.dateKey === "string" && input.dateKey.trim() ? input.dateKey.trim() : null;
  return { operationType: input.operationType, saleId, dateKey };
}

export function forensicAdjustmentSaleId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  const raw = row.saleId ?? row.sale_id;
  const id = typeof raw === "string" ? raw.trim() : "";
  return id || null;
}

export function forensicAdjustmentOperationType(
  kind: string,
  payload: unknown,
): SaleAdjustmentOperationType | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return kind === "pending_returns" ? SALE_ADJUSTMENT_RETURN : null;
  }
  const row = payload as Record<string, unknown>;
  const explicit = String(row.operationType ?? "").trim();
  if (explicit === SALE_ADJUSTMENT_RETURN || explicit === SALE_ADJUSTMENT_VOID) return explicit;
  const hint = String(row.kind ?? row.referenceType ?? row.route ?? "").toLowerCase();
  if (kind === "pending_returns" || hint === "return" || explicit === "return") return SALE_ADJUSTMENT_RETURN;
  if (hint.includes("void") || kind.includes("void")) return SALE_ADJUSTMENT_VOID;
  return null;
}
