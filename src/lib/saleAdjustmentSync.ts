/**
 * Sale-adjustment outbox — Return/Void are durable operations, not sale re-completion.
 * SALE_CLOUD_ACKED is the existing sale.pendingSync flag. No new sale field.
 */

import type { SyncOperation } from "../types";

export const WAITING_FOR_SALE_ERROR = "waiting_for_sale";
export const SALE_ADJUSTMENT_RETURN = "return";
export const SALE_ADJUSTMENT_VOID = "void";
export const RPC_FAILED_ERROR = "rpc_failed";

export type SyncProcessStatus = "ack" | "retry" | "wait" | "park" | "block";
export type SyncProcessRetry = { status: "retry"; lastError: string };
export type SyncProcessBlock = { status: "block"; lastError: string };
export type SyncProcessResult = SyncProcessStatus | SyncProcessRetry | SyncProcessBlock;
export type SaleAdjustmentOperationType = typeof SALE_ADJUSTMENT_RETURN | typeof SALE_ADJUSTMENT_VOID;

export type ShopPushSaleReturnOutcome = {
  status: "ack" | "retry" | "park" | "block";
  lastError?: string;
};

/** Permanent business-validation rejections. Waiting will not make them succeed. */
export const BLOCKED_BUSINESS_ERRORS = new Set<string>([
  "invalid_payload",
  "unlinked_return_forbidden",
  "unlinked_note_required",
  "sale_not_found",
  "product_not_found",
  "refund_exceeds_remaining",
  "refund_exceeds_sale",
  "product_not_on_sale",
  "return_qty_exceeds_sold",
  "refund_exceeds_line",
  "invalid_uuid",
  "product_not_in_shop",
  "constraint_violation",
]);

export function isBlockedBusinessSyncError(error?: string | null): boolean {
  return BLOCKED_BUSINESS_ERRORS.has(String(error ?? "").trim());
}

const RPC_BUSINESS_ERRORS = new Set<string>([
  "not_authenticated",
  "shop_required",
  "forbidden",
  ...BLOCKED_BUSINESS_ERRORS,
  "closed_business_date",
]);

const POSTGREST_CODE_ERRORS = new Set<string>(["401", "403", "42501", "42P01", "PGRST"]);

const STORED_SYNC_ERRORS = new Set<string>([
  ...RPC_BUSINESS_ERRORS,
  ...POSTGREST_CODE_ERRORS,
  RPC_FAILED_ERROR,
]);

export function sanitizeStoredSyncError(error?: string | null): string | null {
  const token = String(error ?? "").trim();
  return STORED_SYNC_ERRORS.has(token) ? token : null;
}

export function classifyPostgrestSyncError(code?: string | null): string {
  const token = String(code ?? "").trim();
  if (token === "401" || token === "403" || token === "42501" || token === "42P01") return token;
  if (token.startsWith("PGRST")) return "PGRST";
  return RPC_FAILED_ERROR;
}

/** Exact/safe sqlerrm tokens only. Never persist the raw message. */
export function classifySyncExceptionMessage(raw?: string | null): string {
  const msg = String(raw ?? "").trim();
  if (msg === "closed_business_date") return "closed_business_date";
  if (msg === "invalid input syntax for type uuid") return "invalid_uuid";
  if (/^Product .+ not in shop$/.test(msg)) return "product_not_in_shop";
  const lower = msg.toLowerCase();
  if (
    lower.includes("violates unique constraint") ||
    lower.includes("violates foreign key constraint") ||
    lower.includes("violates not-null constraint") ||
    lower.includes("violates check constraint") ||
    lower.includes("duplicate key value")
  ) {
    return "constraint_violation";
  }
  return RPC_FAILED_ERROR;
}

export function classifyShopPushSaleReturnOutcome(input: {
  error?: { code?: string | null; message?: string | null } | null;
  data?: { ok?: boolean; error?: string | null } | null;
}): ShopPushSaleReturnOutcome {
  if (input.error) {
    return { status: "retry", lastError: classifyPostgrestSyncError(input.error.code) };
  }
  const data = input.data;
  if (data?.ok === true) return { status: "ack" };
  const business = String(data?.error ?? "").trim();
  if (business === "closed_business_date") {
    return { status: "park", lastError: "closed_business_date" };
  }
  if (isBlockedBusinessSyncError(business)) {
    return { status: "block", lastError: business };
  }
  if (business && RPC_BUSINESS_ERRORS.has(business)) {
    return { status: "retry", lastError: business };
  }
  if (business) {
    const fromException = classifySyncExceptionMessage(business);
    if (fromException === "closed_business_date") {
      return { status: "park", lastError: "closed_business_date" };
    }
    if (isBlockedBusinessSyncError(fromException)) {
      return { status: "block", lastError: fromException };
    }
    return { status: "retry", lastError: fromException };
  }
  return { status: "retry", lastError: RPC_FAILED_ERROR };
}

export function syncProcessStatus(result: SyncProcessResult): SyncProcessStatus {
  return typeof result === "string" ? result : result.status;
}

export function syncProcessLastError(result: SyncProcessResult): string | undefined {
  return typeof result === "string" ? undefined : result.lastError;
}

export function isSyncAck(result: SyncProcessResult): boolean {
  return syncProcessStatus(result) === "ack";
}

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

/** Persist an allowlisted business rejection without ACK, delete, or attempt increment. */
export function markSyncOpBlockedBusiness(op: SyncOperation, lastError?: string | null): SyncOperation {
  const sanitized = sanitizeStoredSyncError(lastError);
  if (!sanitized) return { ...op };
  return {
    ...op,
    lastError: sanitized,
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
