import type { Product, Sale } from "../types";
import { getProductBatches, applyBatchRestorations, type FefoAllocation } from "./pharmacyBatches";

export type ControlledReturnBatchResolution = {
  ok: boolean;
  errorKey?: "pharmacyControlledReturnBatchRequired" | "missingProduct" | "invalidQty";
  batchId?: string | null;
  batchNumber?: string | null;
  batchExpiry?: string | null;
  allocations?: FefoAllocation[];
};

export function resolveControlledReturnBatch(input: {
  product: Product;
  quantity: number;
  batchId?: string | null;
  batchNumber?: string | null;
  sale?: Sale | null;
  productId: string;
  forceBatchOverride?: boolean;
}): ControlledReturnBatchResolution {
  const qty = Math.max(1, Math.floor(input.quantity));
  const batches = getProductBatches(input.product);

  if (input.batchId) {
    const batch = batches.find((b) => b.id === input.batchId);
    if (!batch) {
      return input.forceBatchOverride
        ? fefoFallback(input.product, qty)
        : { ok: false, errorKey: "pharmacyControlledReturnBatchRequired" };
    }
    return {
      ok: true,
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      batchExpiry: batch.expiryDate,
      allocations: [{ batchId: batch.id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, quantity: qty }],
    };
  }

  if (input.sale) {
    const line = input.sale.lines.find((l) => l.productId === input.productId && !l.voided);
    const lineBatchId = line?.pharmacyBatchOverrideId ?? null;
    const lineBatchNumber = line?.pharmacyBatchNumber ?? null;
    if (lineBatchId) {
      const batch = batches.find((b) => b.id === lineBatchId);
      if (batch) {
        return {
          ok: true,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          batchExpiry: batch.expiryDate,
          allocations: [{ batchId: batch.id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, quantity: qty }],
        };
      }
    }
    if (lineBatchNumber) {
      const batch = batches.find((b) => b.batchNumber === lineBatchNumber);
      if (batch) {
        return {
          ok: true,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          batchExpiry: batch.expiryDate,
          allocations: [{ batchId: batch.id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, quantity: qty }],
        };
      }
    }
  }

  if (input.batchNumber) {
    const batch = batches.find((b) => b.batchNumber === input.batchNumber);
    if (batch) {
      return {
        ok: true,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        batchExpiry: batch.expiryDate,
        allocations: [{ batchId: batch.id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, quantity: qty }],
      };
    }
  }

  if (input.forceBatchOverride) {
    return fefoFallback(input.product, qty);
  }

  return batches.length > 0
    ? { ok: false, errorKey: "pharmacyControlledReturnBatchRequired" }
    : { ok: true, allocations: [], batchId: null, batchNumber: null, batchExpiry: null };
}

function fefoFallback(product: Product, qty: number): ControlledReturnBatchResolution {
  const batches = getProductBatches(product)
    .filter((b) => b.status !== "depleted")
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const target = batches[0];
  if (!target) return { ok: false, errorKey: "pharmacyControlledReturnBatchRequired" };
  return {
    ok: true,
    batchId: target.id,
    batchNumber: target.batchNumber,
    batchExpiry: target.expiryDate,
    allocations: [{ batchId: target.id, batchNumber: target.batchNumber, expiryDate: target.expiryDate, quantity: qty }],
  };
}

export function restoreProductFromControlledReturn(
  product: Product,
  allocations: FefoAllocation[],
  at: string,
  refId: string,
  actorUserId?: string | null,
  actorName?: string | null,
): Product {
  if (!allocations.length) {
    return product;
  }
  return applyBatchRestorations(product, allocations, {
    type: "returned",
    at,
    refId,
    actorUserId,
    actorName,
    note: "controlled_return",
  });
}
