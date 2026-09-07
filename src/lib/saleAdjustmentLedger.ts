/**
 * SALES-MULTI-01 — reconstruct completed-sale financials from return/void ledgers.
 *
 * Cloud `sales.total_ugx` stays the original completed header (SL-03 ACK + server
 * reports subtract sale_returns). Device B must absorb the same ledger Device A
 * already applied locally via reduceSaleTotalsByAmount.
 */

import type { ReturnRecord, Sale, VoidRecord } from "../types";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { isCompletedSale } from "./saleStatus";

export type SaleAdjustmentLedgerItem = {
  id: string;
  saleId: string;
  amountUgx: number;
  createdAt: string;
  kind: "return" | "void";
  productId: string;
  lineIndex?: number;
  saleVoidedAt?: string | null;
};

export function saleAdjustmentLedgerItems(
  returns: readonly ReturnRecord[],
  voids: readonly VoidRecord[],
): SaleAdjustmentLedgerItem[] {
  const items: SaleAdjustmentLedgerItem[] = [];
  for (const r of returns) {
    if (!r.saleId) continue;
    const amountUgx = Math.max(0, Math.floor(r.refundAmountUgx));
    if (amountUgx <= 0) continue;
    items.push({
      id: r.id,
      saleId: r.saleId,
      amountUgx,
      createdAt: r.createdAt,
      kind: "return",
      productId: r.productId,
    });
  }
  for (const v of voids) {
    const amountUgx = Math.max(0, Math.floor(v.amountUgx));
    if (amountUgx <= 0) continue;
    items.push({
      id: v.id,
      saleId: v.saleId,
      amountUgx,
      createdAt: v.createdAt,
      kind: "void",
      productId: v.productId,
      lineIndex: v.lineIndex,
      saleVoidedAt: v.saleVoidedAt ?? null,
    });
  }
  return items.sort((a, b) => {
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    return a.id.localeCompare(b.id);
  });
}

function markLineVoided(sale: Sale, item: SaleAdjustmentLedgerItem): Sale {
  const lines = sale.lines.map((line, idx) => {
    const match =
      (item.lineIndex != null && idx === item.lineIndex && line.productId === item.productId) ||
      (item.lineIndex == null && line.productId === item.productId);
    if (!match) return line;
    return { ...line, voided: true, voidedAt: line.voidedAt ?? item.createdAt };
  });
  return { ...sale, lines };
}

function applyVoidMarkers(sale: Sale, items: readonly SaleAdjustmentLedgerItem[]): Sale {
  let next = sale;
  let saleVoidedAt = sale.saleVoidedAt ?? null;
  for (const item of items) {
    if (item.kind === "void") next = markLineVoided(next, item);
    if (item.saleVoidedAt) saleVoidedAt = saleVoidedAt ?? item.saleVoidedAt;
  }
  if (saleVoidedAt && saleVoidedAt !== sale.saleVoidedAt) {
    next = { ...next, saleVoidedAt };
  }
  return next;
}

/** Apply unabsorbed return/void ledger amounts onto a completed sale. Idempotent. */
export function absorbCloudSaleAdjustmentLedger(
  sale: Sale,
  returns: readonly ReturnRecord[],
  voids: readonly VoidRecord[],
): Sale {
  if (!isCompletedSale(sale)) return sale;
  const items = saleAdjustmentLedgerItems(returns, voids).filter((i) => i.saleId === sale.id);
  if (items.length === 0) return applyVoidMarkers(sale, items);

  const ledgerAmt = items.reduce((sum, i) => sum + i.amountUgx, 0);
  const absorbed = sale.voidedTotalUgx ?? 0;
  if (absorbed >= ledgerAmt) return applyVoidMarkers(sale, items);

  let next = sale;
  let running = 0;
  for (const item of items) {
    running += item.amountUgx;
    if (running <= absorbed) {
      if (item.kind === "void") next = markLineVoided(next, item);
      continue;
    }
    next = { ...next, ...reduceSaleTotalsByAmount(next, item.amountUgx) };
    if (item.kind === "void") next = markLineVoided(next, item);
  }
  return applyVoidMarkers(next, items);
}

export function absorbCloudSaleAdjustmentLedgers(
  sales: readonly Sale[],
  returns: readonly ReturnRecord[],
  voids: readonly VoidRecord[],
): Sale[] {
  if (returns.length === 0 && voids.length === 0) return [...sales];
  return sales.map((sale) => absorbCloudSaleAdjustmentLedger(sale, returns, voids));
}

export type CloudVoidRow = {
  record: VoidRecord;
  updatedAt: string;
};

export function rowToVoidRecord(row: Record<string, unknown>): CloudVoidRow | null {
  const id = String(row.id ?? "").trim();
  const saleId = String(row.sale_id ?? "").trim();
  const productId = String(row.product_id ?? "").trim();
  if (!id || !saleId || !productId) return null;
  const meta =
    row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
  const createdAt = String(row.created_at ?? new Date().toISOString());
  const updatedAt = String(row.updated_at ?? createdAt);
  const amountUgx = Math.max(0, Math.floor(Number(row.amount_ugx ?? 0)));
  const quantity = Math.max(0, Number(row.quantity ?? 0));
  if (amountUgx <= 0) return null;
  const record: VoidRecord = {
    id,
    saleId,
    lineIndex: Math.max(0, Math.floor(Number(row.line_index ?? meta.lineIndex ?? 0))),
    productId,
    productName: String(meta.productName ?? productId),
    quantity,
    amountUgx,
    reason: "other",
    note: row.note != null ? String(row.note) : undefined,
    actorUserId: String(row.created_by ?? "unknown"),
    actorName: meta.actorName != null ? String(meta.actorName) : undefined,
    shiftId: meta.shiftId != null ? String(meta.shiftId) : null,
    createdAt,
    saleVoidedAt: row.sale_voided_at != null ? String(row.sale_voided_at) : null,
  };
  return { record, updatedAt };
}

function recencyMs(createdAt: string, updatedAt?: string): number {
  const u = updatedAt ? new Date(updatedAt).getTime() : Number.NaN;
  if (!Number.isNaN(u)) return u;
  const c = new Date(createdAt).getTime();
  return Number.isNaN(c) ? 0 : c;
}

export function mergeVoidRecordsForRecovery(
  local: readonly VoidRecord[],
  remote: readonly CloudVoidRow[],
): VoidRecord[] {
  const map = new Map<string, { record: VoidRecord; updatedAt: string }>();
  for (const v of local) {
    map.set(v.id, { record: v, updatedAt: v.createdAt });
  }
  for (const { record, updatedAt } of remote) {
    const existing = map.get(record.id);
    if (!existing || recencyMs(existing.record.createdAt, existing.updatedAt) <= recencyMs(record.createdAt, updatedAt)) {
      map.set(record.id, { record, updatedAt });
    }
  }
  return [...map.values()]
    .map((x) => x.record)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
