/**
 * Recovery inventory ledger healing — synthesize missing sale/opening movements after cloud pull.
 */

import type { Product, Sale, StockMovement } from "../types";
import { usePosStore } from "../store/usePosStore";
import { isCompletedSale } from "./saleStatus";
import { inventoryMovementNamespace } from "./shopSyncContext";
import { mergeStockMovementsFromCloudPull } from "./stockMovementRecovery";
import {
  saleStockMovementsFromSale,
  stableInventoryMovementId,
  verifyInventoryIntegrity,
  type InventoryIntegrityMismatch,
} from "./inventoryIntegrity";

export type InventoryIntegrityStatus = "healthy" | "warning" | "critical";

export const INVENTORY_INTEGRITY_CRITICAL_MISMATCH_COUNT = 3;
export const SEVERE_INVENTORY_DELTA_UNITS = 50;

export function isSevereInventoryMismatch(mismatch: InventoryIntegrityMismatch): boolean {
  if (mismatch.recordedStock < -0.0001) return true;
  const base = Math.max(mismatch.recordedStock, mismatch.expectedFromMovements, 1);
  if (
    Math.abs(mismatch.delta) >= SEVERE_INVENTORY_DELTA_UNITS &&
    Math.abs(mismatch.delta) / base >= 0.25
  ) {
    return true;
  }
  return false;
}

/** Aligns recovery validation with post-restore thresholds plus severe/negative stock rules. */
export function classifyInventoryIntegrityStatus(
  mismatches: InventoryIntegrityMismatch[],
): InventoryIntegrityStatus {
  if (mismatches.length === 0) return "healthy";
  if (mismatches.some(isSevereInventoryMismatch)) return "critical";
  if (mismatches.length >= INVENTORY_INTEGRITY_CRITICAL_MISMATCH_COUNT) return "critical";
  return "warning";
}

export type RecoveryInventoryReconciliationReport = {
  checkedAt: string;
  productsRestored: number;
  movementsBefore: number;
  movementsAfter: number;
  syntheticSaleMovements: number;
  syntheticOpeningMovements: number;
  remainingMismatches: InventoryIntegrityMismatch[];
  status: InventoryIntegrityStatus;
  healed: boolean;
};

function sumDeltasByProduct(movements: StockMovement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of movements) {
    out.set(m.productId, (out.get(m.productId) ?? 0) + m.deltaBaseUnits);
  }
  return out;
}

function synthesizeSaleMovementsFromSales(shopKey: string, sales: Sale[]): StockMovement[] {
  const out: StockMovement[] = [];
  for (const sale of sales) {
    if (!isCompletedSale(sale)) continue;
    out.push(...saleStockMovementsFromSale(shopKey, sale));
  }
  return out;
}

function synthesizeOpeningMovements(
  shopKey: string,
  products: Product[],
  movements: StockMovement[],
): StockMovement[] {
  const deltasByProduct = sumDeltasByProduct(movements);
  const out: StockMovement[] = [];

  for (const product of products) {
    const deltaSum = deltasByProduct.get(product.id) ?? 0;
    const recorded = product.stockOnHand;
    const expected = Math.max(0, deltaSum);
    if (Math.abs(recorded - expected) <= 0.0001) continue;

    const impliedOpening = recorded - deltaSum;
    if (impliedOpening <= 0.0001) continue;

    const id = stableInventoryMovementId(shopKey, "recovery_opening", product.id, product.id);
    if (movements.some((m) => m.id === id)) continue;

    out.push({
      id,
      at: product.updatedAt,
      productId: product.id,
      productName: product.name,
      deltaBaseUnits: impliedOpening,
      kind: "adjust_other",
      summary: "Recovery opening balance",
      refId: product.id,
      supplierId: null,
    });
  }

  return out;
}

export function reconcileRecoveryInventoryLedger(input?: {
  products?: Product[];
  sales?: Sale[];
  stockMovements?: StockMovement[];
  shopKey?: string;
  applyToStore?: boolean;
}): RecoveryInventoryReconciliationReport {
  const state = usePosStore.getState();
  const products = input?.products ?? state.products;
  const sales = input?.sales ?? state.sales;
  const movementsBefore = input?.stockMovements ?? state.stockMovements;
  const shopKey = input?.shopKey ?? inventoryMovementNamespace();
  const applyToStore = input?.applyToStore !== false;

  const saleSynth = synthesizeSaleMovementsFromSales(shopKey, sales);
  let merged = mergeStockMovementsFromCloudPull(movementsBefore, saleSynth);
  const syntheticSaleMovements = saleSynth.filter(
    (m) => !movementsBefore.some((existing) => existing.id === m.id),
  ).length;

  const openingSynth = synthesizeOpeningMovements(shopKey, products, merged);
  merged = mergeStockMovementsFromCloudPull(merged, openingSynth);
  const syntheticOpeningMovements = openingSynth.length;

  if (applyToStore && merged.length !== movementsBefore.length) {
    usePosStore.setState({ stockMovements: merged });
  } else if (applyToStore) {
    const beforeIds = new Set(movementsBefore.map((m) => m.id));
    const changed = merged.some((m) => !beforeIds.has(m.id));
    if (changed) {
      usePosStore.setState({ stockMovements: merged });
    }
  }

  const integrity = verifyInventoryIntegrity({ products, movements: merged });
  const status = classifyInventoryIntegrityStatus(integrity.mismatches);

  return {
    checkedAt: new Date().toISOString(),
    productsRestored: products.length,
    movementsBefore: movementsBefore.length,
    movementsAfter: merged.length,
    syntheticSaleMovements,
    syntheticOpeningMovements,
    remainingMismatches: integrity.mismatches,
    status,
    healed: integrity.ok,
  };
}
