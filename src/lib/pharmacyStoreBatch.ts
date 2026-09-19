import type { BusinessType, PharmacyBatchReceiveInput, PharmacyWriteOffReason, Product } from "../types";
import {
  appendBatchToProduct,
  applyBatchRestorations,
  createBatchOnReceive,
  deductProductBatchesFefo,
  getProductBatches,
  isBatchTrackedProduct,
  writeOffFromBatches,
  type FefoAllocation,
} from "./pharmacyBatches";
import { isPharmacyMode } from "./pharmacy";

export function applyBatchReceiveToProduct(
  product: Product,
  batchInput: PharmacyBatchReceiveInput,
  ctx: {
    supplierId?: string | null;
    supplierName?: string | null;
    purchaseId?: string;
    at: string;
    actorUserId?: string | null;
    actorName?: string | null;
  },
): Product {
  const batch = createBatchOnReceive({
    ...batchInput,
    supplierId: ctx.supplierId,
    supplierName: ctx.supplierName,
    purchaseId: ctx.purchaseId,
    at: ctx.at,
    actorUserId: ctx.actorUserId,
    actorName: ctx.actorName,
  });
  return appendBatchToProduct(product, batch);
}

export function applySaleBatchFefo(
  product: Product,
  quantity: number,
  ctx: {
    at: string;
    saleId: string;
    actorUserId?: string;
    actorName?: string;
    overrideBatchId?: string | null;
  },
): { product: Product; usedOverride: boolean; allocations: FefoAllocation[] } {
  const { product: next, allocations, usedOverride } = deductProductBatchesFefo(product, quantity, {
    at: ctx.at,
    refId: ctx.saleId,
    actorUserId: ctx.actorUserId,
    actorName: ctx.actorName,
    overrideBatchId: ctx.overrideBatchId,
    eventType: "dispensed",
  });
  return { product: next, usedOverride, allocations };
}

export type SaleLineBatchRef = {
  pharmacyBatchOverrideId?: string | null;
  pharmacyBatchNumber?: string | null;
};

/**
 * Restore `quantity` units back into the specific batch a sale line was
 * originally fulfilled from — resolved from the SaleLine's own batch
 * reference, the same way `resolveControlledReturnBatch` already does for
 * controlled returns. Only ever moves batch quantities (never
 * stockOnHand/cost/any Sale field — the caller is responsible for that via
 * the authoritative mechanism, unchanged). Does nothing (no invented
 * fallback batch) when the original batch can no longer be resolved; any
 * resulting drift stays visible to `computeBatchIntegrity`, never
 * silently papered over.
 */
export function restoreSaleLineBatchQuantity(
  product: Product,
  line: SaleLineBatchRef,
  quantity: number,
  ctx: {
    type: "adjusted" | "returned";
    at: string;
    refId: string;
    actorUserId?: string | null;
    actorName?: string | null;
    note?: string | null;
  },
): Product {
  if (!isBatchTrackedProduct(product)) return product;
  const qty = Math.max(0, Math.floor(quantity));
  if (qty <= 0) return product;
  const batches = getProductBatches(product);
  const target =
    (line.pharmacyBatchOverrideId ? batches.find((b) => b.id === line.pharmacyBatchOverrideId) : null) ??
    (line.pharmacyBatchNumber ? batches.find((b) => b.batchNumber === line.pharmacyBatchNumber) : null);
  if (!target) return product;
  return applyBatchRestorations(
    product,
    [{ batchId: target.id, batchNumber: target.batchNumber, expiryDate: target.expiryDate, quantity: qty }],
    {
      type: ctx.type,
      at: ctx.at,
      refId: ctx.refId,
      actorUserId: ctx.actorUserId,
      actorName: ctx.actorName,
      note: ctx.note,
    },
  );
}

export function applyPharmacyWriteOff(
  product: Product,
  quantity: number,
  reason: PharmacyWriteOffReason,
  ctx: {
    at: string;
    batchId?: string;
    actorUserId?: string;
    actorName?: string;
    note?: string;
  },
): { product: Product; lossValueUgx: number; writtenOff: number } {
  return writeOffFromBatches(product, quantity, reason, {
    batchId: ctx.batchId,
    at: ctx.at,
    actorUserId: ctx.actorUserId,
    actorName: ctx.actorName,
    note: ctx.note,
  });
}

export function shouldTrackBatchesForProduct(
  businessType: BusinessType | undefined | null,
  pharmacyModeEnabled: boolean | null | undefined,
  product: Product,
): boolean {
  return isPharmacyMode(businessType, pharmacyModeEnabled) && product.pharmacyMaster?.batchTracked !== false;
}
