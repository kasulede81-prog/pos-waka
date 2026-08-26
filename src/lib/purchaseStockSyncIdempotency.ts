/**
 * At-most-once purchase stock-in sync helpers (Restock Double-Count Fix R1).
 *
 * Local markers survive queue replay; server lastStockNote idempotency is the
 * crash-window guarantee (see migration 165_purchase_stock_push_idempotent.sql).
 */

import type { Product, Purchase, PurchaseLine } from "../types";
import { purchaseLineBaseUnitsIn } from "./purchaseLineSync";

/** Cloud stock note for one purchase — stable across lines on different products. */
export function purchaseStockSyncNote(purchaseId: string, _productId?: string): string {
  return `purchase:${purchaseId}`;
}

export function isPurchaseStockLineSynced(
  purchase: Pick<Purchase, "stockSyncedProductIds" | "stockSyncedAt">,
  productId: string,
): boolean {
  if (purchase.stockSyncedAt) return true;
  const ids = purchase.stockSyncedProductIds;
  return Array.isArray(ids) && ids.includes(productId);
}

export function withPurchaseStockLineSynced(
  purchase: Purchase,
  productId: string,
  atIso: string = new Date().toISOString(),
): Purchase {
  const prev = Array.isArray(purchase.stockSyncedProductIds) ? purchase.stockSyncedProductIds : [];
  const stockSyncedProductIds = prev.includes(productId) ? prev : [...prev, productId];
  const lineProductIds = [...new Set(purchase.lines.map((l) => l.productId).filter(Boolean))];
  const allDone =
    lineProductIds.length > 0 && lineProductIds.every((id) => stockSyncedProductIds.includes(id));
  return {
    ...purchase,
    stockSyncedProductIds,
    ...(allDone ? { stockSyncedAt: purchase.stockSyncedAt ?? atIso } : {}),
  };
}

export function purchaseStockLinesNeedingCloudPush(
  purchase: Purchase,
  products: Product[],
): { productId: string; delta: number; note: string; line: PurchaseLine }[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const out: { productId: string; delta: number; note: string; line: PurchaseLine }[] = [];
  const seen = new Set<string>();
  for (const line of purchase.lines) {
    if (!line.productId || seen.has(line.productId)) continue;
    seen.add(line.productId);
    if (isPurchaseStockLineSynced(purchase, line.productId)) continue;
    const product = productById.get(line.productId);
    if (!product) continue;
    const delta = purchaseLineBaseUnitsIn(product, line);
    if (delta <= 0) continue;
    out.push({
      productId: line.productId,
      delta,
      note: purchaseStockSyncNote(purchase.id),
      line,
    });
  }
  return out;
}

/**
 * Pure model of shop_push_product_stock purchase-note idempotency (+ stale retry).
 * Used by focused tests — mirrors migration 165 semantics for purchase: notes.
 */
export type SimulatedProductStockRow = {
  stockOnHand: number;
  updatedAt: string;
  lastStockNote: string | null;
};

export type SimulatedStockPushInput = {
  delta: number;
  note: string;
  baseUpdatedAt: string | null;
  baseStockOnHand: number | null;
};

export type SimulatedStockPushResult =
  | { ok: true; idempotent?: boolean; stockOnHand: number; updatedAt: string }
  | {
      ok: false;
      error: "stale_version";
      serverStockOnHand: number;
      serverUpdatedAt: string;
    };

export function simulateShopPushProductStock(
  row: SimulatedProductStockRow,
  input: SimulatedStockPushInput,
  nowIso: string,
): { row: SimulatedProductStockRow; result: SimulatedStockPushResult } {
  const note = input.note.trim();
  if (note.startsWith("purchase:") && row.lastStockNote === note) {
    return {
      row,
      result: {
        ok: true,
        idempotent: true,
        stockOnHand: row.stockOnHand,
        updatedAt: row.updatedAt,
      },
    };
  }

  if (
    input.baseUpdatedAt != null &&
    row.updatedAt > input.baseUpdatedAt &&
    input.baseStockOnHand != null &&
    row.stockOnHand !== input.baseStockOnHand
  ) {
    return {
      row,
      result: {
        ok: false,
        error: "stale_version",
        serverStockOnHand: row.stockOnHand,
        serverUpdatedAt: row.updatedAt,
      },
    };
  }

  const next: SimulatedProductStockRow = {
    stockOnHand: Math.max(0, row.stockOnHand + input.delta),
    updatedAt: nowIso,
    lastStockNote: note || row.lastStockNote,
  };
  return {
    row: next,
    result: { ok: true, stockOnHand: next.stockOnHand, updatedAt: next.updatedAt },
  };
}

/**
 * Simulate dual queue / retry delivery of the same purchase stock note with
 * the client's stale_version retry behavior (adopt server, resend same delta).
 */
export function simulatePurchaseStockDeliveryAttempts(
  initial: SimulatedProductStockRow,
  attempts: SimulatedStockPushInput[],
  clock: string[],
): SimulatedProductStockRow {
  let row = { ...initial };
  let t = 0;
  const nextTs = () => clock[Math.min(t++, clock.length - 1)] ?? clock[clock.length - 1]!;

  for (const attempt of attempts) {
    let input = { ...attempt };
    for (let retry = 0; retry < 4; retry++) {
      const { row: next, result } = simulateShopPushProductStock(row, input, nextTs());
      row = next;
      if (result.ok) break;
      // Client stale recovery: adopt server, keep same delta/note.
      input = {
        ...input,
        baseUpdatedAt: result.serverUpdatedAt,
        baseStockOnHand: result.serverStockOnHand,
      };
    }
  }
  return row;
}
