/**
 * Purchase line unit-mode helpers — prevent double base-unit conversion during cloud sync.
 */

import type { Product, Purchase, PurchaseLine } from "../types";
import { isPurchaseVoided } from "./purchaseCorrections";
import { baseUnitsPerBuyingUnit, buyingUnitsToBaseUnits } from "./sellingEngine";

export type PurchaseLineUnitMode = "buying_units" | "base_units";

export function normalizePurchaseLineUnitMode(raw: unknown): PurchaseLineUnitMode {
  if (raw === "base_units" || raw === "baseUnits") return "base_units";
  return "buying_units";
}

/** Base units received for one purchase line (respects explicit unitMode). */
export function purchaseLineBaseUnitsIn(product: Product, line: PurchaseLine): number {
  const mode = line.unitMode ?? "buying_units";
  const qty = Math.max(0, line.qtyBuyingUnits);
  if (mode === "base_units") return Math.floor(qty);
  return buyingUnitsToBaseUnits(product, qty);
}

export function serializePurchaseLineForCloud(line: PurchaseLine): Record<string, unknown> {
  const row: Record<string, unknown> = {
    productId: line.productId,
    name: line.name,
    qtyBuyingUnits: line.qtyBuyingUnits,
    costPerBuyingUnitUgx: line.costPerBuyingUnitUgx,
  };
  if (line.unitMode) row.unitMode = line.unitMode;
  return row;
}

export function parsePurchaseLineFromCloud(raw: Record<string, unknown>): PurchaseLine | null {
  const productId = String(raw.productId ?? raw.product_id ?? "").trim();
  if (!productId) return null;
  const unitMode = raw.unitMode != null || raw.unit_mode != null
    ? normalizePurchaseLineUnitMode(raw.unitMode ?? raw.unit_mode)
    : undefined;
  return {
    productId,
    name: String(raw.name ?? ""),
    qtyBuyingUnits: Math.max(0, Number(raw.qtyBuyingUnits ?? raw.qty_buying_units ?? 0)),
    costPerBuyingUnitUgx: Math.max(
      0,
      Math.floor(Number(raw.costPerBuyingUnitUgx ?? raw.cost_per_buying_unit_ugx ?? 0)),
    ),
    ...(unitMode ? { unitMode } : {}),
  };
}

/** Heuristic: pharmacy/base-unit line stored without unitMode may double-convert on sync. */
export function isLikelyBaseUnitLineMismatch(product: Product, line: PurchaseLine): boolean {
  if (line.unitMode === "base_units") return false;
  if (line.unitMode === "buying_units") return false;
  const per = baseUnitsPerBuyingUnit(product);
  if (per <= 1) return false;
  const asBuying = buyingUnitsToBaseUnits(product, line.qtyBuyingUnits);
  if (asBuying === line.qtyBuyingUnits) return false;
  return line.qtyBuyingUnits < per && Number.isInteger(line.qtyBuyingUnits);
}

export function findBaseUnitPurchaseWarnings(
  purchases: Purchase[],
  products: Product[],
): { purchaseId: string; productId: string; productName: string }[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const warnings: { purchaseId: string; productId: string; productName: string }[] = [];
  for (const purchase of purchases) {
    for (const line of purchase.lines) {
      const product = productById.get(line.productId);
      if (!product || !isLikelyBaseUnitLineMismatch(product, line)) continue;
      warnings.push({
        purchaseId: purchase.id,
        productId: line.productId,
        productName: line.name || product.name,
      });
    }
  }
  return warnings;
}

/** Whether cloud void should push negative stock (purchase was synced before void). */
export function shouldPushVoidStockReversal(
  purchase: Pick<Purchase, "voidedAt" | "preVoidCloudSynced" | "voidStockSyncedAt">,
): boolean {
  return isPurchaseVoided(purchase) && purchase.preVoidCloudSynced === true && !purchase.voidStockSyncedAt;
}

export function computeVoidStockDeltas(
  purchase: Purchase,
  products: Product[],
): { productId: string; delta: number }[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const out: { productId: string; delta: number }[] = [];
  for (const line of purchase.lines) {
    const product = productById.get(line.productId);
    if (!product) continue;
    const baseOut = purchaseLineBaseUnitsIn(product, line);
    if (baseOut > 0) out.push({ productId: line.productId, delta: -baseOut });
  }
  return out;
}
