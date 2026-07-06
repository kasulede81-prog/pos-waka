import type { BusinessType, PharmacyBatchReceiveInput, PharmacyWriteOffReason, Product } from "../types";
import {
  appendBatchToProduct,
  createBatchOnReceive,
  deductProductBatchesFefo,
  writeOffFromBatches,
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
): { product: Product; usedOverride: boolean } {
  const { product: next, usedOverride } = deductProductBatchesFefo(product, quantity, {
    at: ctx.at,
    refId: ctx.saleId,
    actorUserId: ctx.actorUserId,
    actorName: ctx.actorName,
    overrideBatchId: ctx.overrideBatchId,
    eventType: "dispensed",
  });
  return { product: next, usedOverride };
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
