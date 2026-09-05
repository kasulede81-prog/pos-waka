import type { BusinessType, PharmacyBatchReceiveInput, Product } from "../types";
import { buyingUnitsToBaseUnits, costPerBaseFromBuyingUnitCost } from "./sellingEngine";
import { shouldTrackBatchesForProduct } from "./pharmacyStoreBatch";

/** Same qty/cost parse RestockPage already uses for purchase totals. */
export function parseRestockLineQtyCost(row: {
  qtyBuyingStr: string;
  costPerBuyingStr: string;
}): { qtyBuyingUnits: number; costPerBuyingUnitUgx: number } {
  return {
    qtyBuyingUnits: Number(row.qtyBuyingStr) || 0,
    costPerBuyingUnitUgx: Math.floor(Number(row.costPerBuyingStr.replace(/\D/g, "")) || 0),
  };
}

export type RestockLineDraft = {
  productId: string;
  qtyBuyingStr: string;
  costPerBuyingStr: string;
  batchNumber?: string;
  expiryDate?: string;
  manufactureDate?: string;
  location?: string;
};

export type RestockPurchaseLine = {
  productId: string;
  qtyBuyingUnits: number;
  costPerBuyingUnitUgx: number;
  batchReceive?: PharmacyBatchReceiveInput;
};

export type BuildRestockPurchaseLinesResult =
  | { ok: true; lines: RestockPurchaseLine[] }
  | { ok: false; errorKey: string };

/**
 * Build recordPurchase lines from RestockPage rows.
 * Retail/non-batch lines stay qtyBuyingUnits + cost only.
 * Batch-tracked pharmacy lines add the same batchReceive contract as
 * PharmacyReceiveBatchSheet (quantityBase / unitCostUgx in base units).
 */
export function buildRestockPurchaseLines(
  rows: readonly RestockLineDraft[],
  products: readonly Product[],
  ctx: {
    businessType?: BusinessType | null;
    pharmacyModeEnabled?: boolean | null;
    purchaseInvoice?: string | null;
  },
): BuildRestockPurchaseLinesResult {
  const productById = new Map(products.map((p) => [p.id, p]));
  const invoice = ctx.purchaseInvoice?.trim() || null;
  const lines: RestockPurchaseLine[] = [];

  for (const row of rows) {
    const parsed = parseRestockLineQtyCost(row);
    if (!row.productId || parsed.qtyBuyingUnits <= 0 || parsed.costPerBuyingUnitUgx < 0) continue;
    const product = productById.get(row.productId);
    if (!product) continue;

    const line: RestockPurchaseLine = {
      productId: product.id,
      qtyBuyingUnits: parsed.qtyBuyingUnits,
      costPerBuyingUnitUgx: parsed.costPerBuyingUnitUgx,
    };

    if (shouldTrackBatchesForProduct(ctx.businessType, ctx.pharmacyModeEnabled, product)) {
      const batchNumber = (row.batchNumber ?? "").trim();
      const expiryDate = (row.expiryDate ?? "").trim();
      if (!batchNumber) return { ok: false, errorKey: "pharmacyBatchNumberRequired" };
      if (!expiryDate) return { ok: false, errorKey: "pharmacyExpiryDateRequired" };
      const quantityBase = buyingUnitsToBaseUnits(product, parsed.qtyBuyingUnits);
      const unitCostUgx = costPerBaseFromBuyingUnitCost(product, parsed.costPerBuyingUnitUgx);
      line.batchReceive = {
        batchNumber,
        expiryDate,
        quantityBase,
        unitCostUgx,
        manufactureDate: row.manufactureDate?.trim() || null,
        purchaseInvoice: invoice,
        location: row.location?.trim() || null,
      };
    }

    lines.push(line);
  }

  if (lines.length === 0) return { ok: false, errorKey: "restockAddLineHint" };
  return { ok: true, lines };
}
