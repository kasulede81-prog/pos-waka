import type { PrepBatch } from "../types";

/**
 * One durable prep-batch event in the existing Kiosk Duka sync queue.
 * Stock for create remains on the existing pending_stock_updates path; waste/cancel
 * carry their durable adjustment ids so the server applies the portion-dependent
 * stock exactly once. Sale/void/return events change batch portions only.
 */
export type PrepBatchSyncPayload = {
  kind: "create" | "waste" | "cancel" | "sale_consume" | "sale_void" | "sale_return";
  eventId: string;
  batchId?: string;
  productId?: string;
  batch?: PrepBatch;
  ingredientRequirements?: Array<{ productId: string; quantityBase: number }>;
  ingredientBasisPortions?: number;
  portions?: number;
  reason?: string;
  saleId?: string;
  saleLineId?: string;
  quantity?: number;
  dishStockAdjustmentId?: string;
  ingredientAdjustments?: Array<{ productId: string; adjustmentId: string }>;
  createdAt: string;
};

/** Minimal structural guard for a batch projected by the server. */
export function isServerPrepBatch(value: unknown): value is PrepBatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.id === "string" &&
    typeof b.menuProductId === "string" &&
    typeof b.preparedAt === "string" &&
    typeof b.portionsPrepared === "number" &&
    typeof b.remainingPortions === "number" &&
    typeof b.unitCostUgx === "number" &&
    typeof b.status === "string" &&
    typeof b.version === "number"
  );
}
