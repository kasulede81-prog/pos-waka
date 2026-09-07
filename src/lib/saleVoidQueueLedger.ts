/**
 * SALES-MULTI-01 P2-02 — enrich a pre-179 stock-only void queue payload
 * from the local VoidRecord that already holds the financial amount.
 * Does not guess. Missing/ambiguous records stay stock-only.
 */

import type { VoidRecord } from "../types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export type SaleVoidQueueLedger = {
  saleId?: string;
  amountUgx?: number;
  lineIndex?: number;
  saleVoidedAt?: string | null;
  productName?: string;
  source: "payload" | "void_record" | "stock_only";
};

function payloadReferenceId(payload: Record<string, unknown>): string {
  const raw = payload.referenceId ?? payload.void_record_id ?? payload.voidRecordId ?? "";
  return String(raw).trim();
}

function payloadSaleId(payload: Record<string, unknown>): string {
  return String(payload.saleId ?? payload.sale_id ?? "").trim();
}

function payloadAmount(payload: Record<string, unknown>): number {
  const n = Number(payload.amountUgx ?? payload.amount_ugx);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

/**
 * Resolve financial void fields for shop_apply_sale_void_stock.
 * Payload fields win. Otherwise only a matching local void_record_id is used.
 */
export function resolveSaleVoidQueueLedger(input: {
  payload: Record<string, unknown>;
  voidRecords: readonly VoidRecord[];
}): SaleVoidQueueLedger {
  const saleId = payloadSaleId(input.payload);
  const amountUgx = payloadAmount(input.payload);
  const lineIndex =
    typeof input.payload.lineIndex === "number"
      ? input.payload.lineIndex
      : typeof input.payload.line_index === "number"
        ? input.payload.line_index
        : undefined;
  const saleVoidedAt =
    typeof input.payload.saleVoidedAt === "string"
      ? input.payload.saleVoidedAt
      : typeof input.payload.sale_voided_at === "string"
        ? input.payload.sale_voided_at
        : undefined;
  const productName =
    typeof input.payload.productName === "string"
      ? input.payload.productName
      : typeof input.payload.product_name === "string"
        ? input.payload.product_name
        : undefined;

  if (isUuid(saleId) && amountUgx > 0) {
    return {
      saleId,
      amountUgx,
      lineIndex,
      saleVoidedAt,
      productName,
      source: "payload",
    };
  }

  const voidId = payloadReferenceId(input.payload);
  if (!isUuid(voidId)) return { source: "stock_only" };

  const matches = input.voidRecords.filter((v) => v.id === voidId);
  if (matches.length !== 1) return { source: "stock_only" };

  const rec = matches[0]!;
  const recSaleId = String(rec.saleId ?? "").trim();
  const recAmount = Math.max(0, Math.floor(Number(rec.amountUgx) || 0));
  if (!isUuid(recSaleId) || recAmount <= 0) return { source: "stock_only" };

  return {
    saleId: recSaleId,
    amountUgx: recAmount,
    lineIndex: rec.lineIndex,
    saleVoidedAt: rec.saleVoidedAt ?? null,
    productName: rec.productName,
    source: "void_record",
  };
}
