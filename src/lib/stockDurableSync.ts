/**
 * Sync R3 + SALE-VOID-STOCK-1.0 — durable stock identity for adjustments,
 * inventory counts, and sale voids. Classification only; cloud RPCs are the authority.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isStockDurableUuid(id: string | null | undefined): id is string {
  return typeof id === "string" && UUID_RE.test(id.trim());
}

export const R3_REF_ADJUSTMENT = "adjustment" as const;
export const R3_REF_INVENTORY_COUNT = "inventory_count" as const;
export const R3_REF_SALE_VOID = "sale_void" as const;

export type R3StockReferenceType = typeof R3_REF_ADJUSTMENT | typeof R3_REF_INVENTORY_COUNT;
export type DurableStockReferenceType = R3StockReferenceType | typeof R3_REF_SALE_VOID;

export type R3StockQueuePayload = {
  productId: string;
  delta: number;
  note: string;
  baseUpdatedAt: string | null;
  baseStockOnHand?: number;
  referenceType: DurableStockReferenceType;
  referenceId: string;
};

export function r3AdjustmentStockPayload(input: {
  productId: string;
  delta: number;
  adjustmentId: string;
  note?: string;
  baseUpdatedAt?: string | null;
  baseStockOnHand?: number;
}): R3StockQueuePayload {
  return {
    productId: input.productId,
    delta: input.delta,
    note: input.note ?? "",
    baseUpdatedAt: input.baseUpdatedAt ?? null,
    baseStockOnHand: input.baseStockOnHand,
    referenceType: R3_REF_ADJUSTMENT,
    referenceId: input.adjustmentId,
  };
}

export function r3InventoryCountStockPayload(input: {
  productId: string;
  delta: number;
  sessionId: string;
  baseUpdatedAt?: string | null;
  baseStockOnHand?: number;
}): R3StockQueuePayload {
  return {
    productId: input.productId,
    delta: input.delta,
    note: `inventory_count:${input.sessionId}`,
    baseUpdatedAt: input.baseUpdatedAt ?? null,
    baseStockOnHand: input.baseStockOnHand,
    referenceType: R3_REF_INVENTORY_COUNT,
    referenceId: input.sessionId,
  };
}

/** SALE-VOID-STOCK-1.0 — immutable void_record_id is the cloud durable reference. */
export function r3SaleVoidStockPayload(input: {
  productId: string;
  delta: number;
  voidRecordId: string;
  note?: string;
  baseUpdatedAt?: string | null;
  baseStockOnHand?: number;
}): R3StockQueuePayload {
  return {
    productId: input.productId,
    delta: input.delta,
    note: input.note ?? "",
    baseUpdatedAt: input.baseUpdatedAt ?? null,
    baseStockOnHand: input.baseStockOnHand,
    referenceType: R3_REF_SALE_VOID,
    referenceId: input.voidRecordId,
  };
}

export type PendingStockRoute =
  | { route: "purchase_void"; purchaseId: string }
  | { route: "purchase"; purchaseId: string }
  | { route: "purchase_note"; productId: string; delta: number; note: string }
  | { route: "r3_adjustment"; productId: string; delta: number; referenceId: string; note: string }
  | { route: "r3_count"; productId: string; delta: number; referenceId: string; note: string }
  | { route: "sale_void"; productId: string; delta: number; referenceId: string; note: string }
  | { route: "catalog_only"; productId: string }
  | { route: "quarantine"; reason: string; productId?: string }
  | { route: "missing_delta"; productId: string };

function readNote(payload: Record<string, unknown>): string {
  return typeof payload.note === "string" ? payload.note : "";
}

function isPurchaseNote(note: string): boolean {
  return note.startsWith("purchase:") && !note.startsWith("purchase_void:");
}

function isSaleVoidPayload(payload: Record<string, unknown>, note: string): boolean {
  return payload.kind === "void" || note === "void" || payload.referenceType === R3_REF_SALE_VOID;
}

/**
 * Route a pending_stock_updates payload.
 * R3 / sale-void without an explicit durable reference is fail-closed (quarantine).
 * Purchase (166) keeps its existing path. Purchase void remains a separate milestone.
 */
export function classifyPendingStockPayload(payload: Record<string, unknown>): PendingStockRoute {
  if (payload.kind === "purchase_void") {
    const purchaseId = String(payload.purchaseId ?? "");
    return { route: "purchase_void", purchaseId };
  }
  if (payload.kind === "purchase") {
    const purchaseId = String(payload.purchaseId ?? "");
    return { route: "purchase", purchaseId };
  }

  const productId = String(payload.productId ?? payload.id ?? "");
  const delta = Number(payload.delta ?? 0);
  const note = readNote(payload);
  const referenceType = typeof payload.referenceType === "string" ? payload.referenceType : "";
  const referenceId = typeof payload.referenceId === "string" ? payload.referenceId.trim() : "";

  if (isPurchaseNote(note) && isStockDurableUuid(productId) && delta !== 0) {
    return { route: "purchase_note", productId, delta, note };
  }

  const hasR3Type = referenceType === R3_REF_ADJUSTMENT || referenceType === R3_REF_INVENTORY_COUNT;
  if (hasR3Type && !isStockDurableUuid(referenceId)) {
    return { route: "quarantine", reason: "r3_missing_reference", productId };
  }

  if (
    referenceType === R3_REF_ADJUSTMENT &&
    isStockDurableUuid(referenceId) &&
    isStockDurableUuid(productId) &&
    delta !== 0
  ) {
    return { route: "r3_adjustment", productId, delta, referenceId, note };
  }

  if (
    referenceType === R3_REF_INVENTORY_COUNT &&
    isStockDurableUuid(referenceId) &&
    isStockDurableUuid(productId) &&
    delta !== 0
  ) {
    return { route: "r3_count", productId, delta, referenceId, note };
  }

  if (referenceType === R3_REF_SALE_VOID && !isStockDurableUuid(referenceId)) {
    return { route: "quarantine", reason: "sale_void_missing_reference", productId };
  }

  if (
    referenceType === R3_REF_SALE_VOID &&
    isStockDurableUuid(referenceId) &&
    isStockDurableUuid(productId) &&
    delta !== 0
  ) {
    return { route: "sale_void", productId, delta, referenceId, note };
  }

  if (payload.catalogOnly === true && isStockDurableUuid(productId)) {
    return { route: "catalog_only", productId };
  }

  // Legacy note:"void" without durable reference — fail closed (no generic RPC).
  if (isStockDurableUuid(productId) && delta !== 0 && isSaleVoidPayload(payload, note)) {
    return { route: "quarantine", reason: "sale_void_missing_reference", productId };
  }

  if (isStockDurableUuid(productId) && delta !== 0) {
    return { route: "quarantine", reason: "r3_legacy_generic_delta", productId };
  }

  return { route: "missing_delta", productId };
}

/** Client retry model for durable stock RPCs: never rebase-and-resend the delta. */
export function shouldAckR3StockResult(result: { ok?: boolean; idempotent?: boolean } | null): boolean {
  return result?.ok === true;
}
