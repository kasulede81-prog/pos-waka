/**
 * At-most-once purchase stock-in sync helpers (R1 + R2).
 *
 * Client markers (stockSyncedProductIds) avoid redundant RPCs / partial retries.
 * Durable authority is server inventory_movements (shop, purchase, purchaseId, productId)
 * — see migration 166_purchase_stock_durable_idempotency.sql.
 */

import type { Product, Purchase, PurchaseLine } from "../types";
import { purchaseLineBaseUnitsIn } from "./purchaseLineSync";

/** Cloud stock note for one purchase — product id travels in RPC payload. */
export function purchaseStockSyncNote(purchaseId: string, _productId?: string): string {
  return `purchase:${purchaseId}`;
}

/** Durable operation key used by server inventory_movements + simulators. */
export function purchaseStockOperationKey(purchaseId: string, productId: string): string {
  return `purchase:${purchaseId}:product:${productId}`;
}

export function parsePurchaseIdFromStockNote(note: string): string | null {
  const n = note.trim();
  if (!n.startsWith("purchase:") || n.startsWith("purchase_void:")) return null;
  const id = n.slice("purchase:".length).split(":")[0]?.trim() ?? "";
  return id.length > 0 ? id : null;
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

/**
 * Lines needing cloud stock push — aggregates duplicate productIds so
 * Coke +10 and Coke +14 become one +24 effect with one durable identity.
 */
export function purchaseStockLinesNeedingCloudPush(
  purchase: Purchase,
  products: Product[],
): { productId: string; delta: number; note: string; line: PurchaseLine }[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const aggregated = new Map<string, { delta: number; line: PurchaseLine }>();

  for (const line of purchase.lines) {
    if (!line.productId) continue;
    const product = productById.get(line.productId);
    if (!product) continue;
    const delta = purchaseLineBaseUnitsIn(product, line);
    if (delta <= 0) continue;
    const prev = aggregated.get(line.productId);
    if (prev) {
      aggregated.set(line.productId, { delta: prev.delta + delta, line: prev.line });
    } else {
      aggregated.set(line.productId, { delta, line });
    }
  }

  const out: { productId: string; delta: number; note: string; line: PurchaseLine }[] = [];
  for (const [productId, { delta, line }] of aggregated) {
    if (isPurchaseStockLineSynced(purchase, productId)) continue;
    out.push({
      productId,
      delta,
      note: purchaseStockSyncNote(purchase.id),
      line,
    });
  }
  return out;
}

/**
 * Pure model of shop_push_product_stock after migration 166:
 * durable applied keys survive lastStockNote overwrite.
 */
export type SimulatedProductStockRow = {
  stockOnHand: number;
  updatedAt: string;
  lastStockNote: string | null;
  /** Durable keys: purchase:<purchaseId>:product:<productId> */
  appliedPurchaseOps: Set<string>;
};

export type SimulatedStockPushInput = {
  productId: string;
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
  const purchaseId = parsePurchaseIdFromStockNote(note);
  const durableKey =
    purchaseId != null ? purchaseStockOperationKey(purchaseId, input.productId) : null;

  // Durable inventory_movements-style check (migration 166).
  if (durableKey && row.appliedPurchaseOps.has(durableKey)) {
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

  // Fast path: lastStockNote (migration 165) — not durable alone.
  if (purchaseId && row.lastStockNote === note) {
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

  const applied = new Set(row.appliedPurchaseOps);
  if (durableKey) applied.add(durableKey);

  const next: SimulatedProductStockRow = {
    stockOnHand: Math.max(0, row.stockOnHand + input.delta),
    updatedAt: nowIso,
    lastStockNote: note || row.lastStockNote,
    appliedPurchaseOps: applied,
  };
  return {
    row: next,
    result: { ok: true, stockOnHand: next.stockOnHand, updatedAt: next.updatedAt },
  };
}

/** Unrelated stock op that overwrites lastStockNote but does NOT erase durable keys. */
export function simulateUnrelatedStockNoteOverwrite(
  row: SimulatedProductStockRow,
  note: string,
  delta: number,
  nowIso: string,
): SimulatedProductStockRow {
  return {
    stockOnHand: Math.max(0, row.stockOnHand + delta),
    updatedAt: nowIso,
    lastStockNote: note,
    appliedPurchaseOps: new Set(row.appliedPurchaseOps),
  };
}

/**
 * Simulate dual queue / retry delivery with client stale_version retry behavior.
 */
export function simulatePurchaseStockDeliveryAttempts(
  initial: SimulatedProductStockRow,
  attempts: SimulatedStockPushInput[],
  clock: string[],
): SimulatedProductStockRow {
  let row = {
    ...initial,
    appliedPurchaseOps: new Set(initial.appliedPurchaseOps),
  };
  let t = 0;
  const nextTs = () => clock[Math.min(t++, clock.length - 1)] ?? clock[clock.length - 1]!;

  for (const attempt of attempts) {
    let input = { ...attempt };
    for (let retry = 0; retry < 4; retry++) {
      const { row: next, result } = simulateShopPushProductStock(row, input, nextTs());
      row = next;
      if (result.ok) break;
      input = {
        ...input,
        baseUpdatedAt: result.serverUpdatedAt,
        baseStockOnHand: result.serverStockOnHand,
      };
    }
  }
  return row;
}

/** Concurrent: two requests serialized like FOR UPDATE — first wins, second sees durable key. */
export function simulateConcurrentPurchaseStockPushes(
  initial: SimulatedProductStockRow,
  input: SimulatedStockPushInput,
  nowA: string,
  nowB: string,
): SimulatedProductStockRow {
  const first = simulateShopPushProductStock(
    { ...initial, appliedPurchaseOps: new Set(initial.appliedPurchaseOps) },
    input,
    nowA,
  );
  const second = simulateShopPushProductStock(first.row, input, nowB);
  return second.row;
}
