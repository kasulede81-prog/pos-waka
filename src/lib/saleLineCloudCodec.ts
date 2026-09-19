/**
 * Sale line cloud metadata codec — round-trip financial snapshots for sync certification.
 */

import type { SaleLine } from "../types";
import { normalizeUnitCostUgx } from "./costPrecision";
import { ensureSaleLineId } from "./pendingSaleMerge";

export type CloudSaleLineRow = {
  id?: string;
  product_id: string;
  quantity: number;
  unit_price_ugx: number;
  line_discount_ugx?: number;
  line_total_ugx: number;
  line_input_mode: "money" | "quantity";
  money_amount_ugx?: number | null;
  metadata: Record<string, unknown>;
};

/**
 * Pharmacy batch provenance — which batch/lot a dispensed line was taken from.
 *
 * These three values are stamped on the finalized SaleLine by finalizeDraftSale (from the FEFO allocation that
 * was actually deducted) and are what a later void or return uses to put the units back into that batch, and
 * what a controlled-medicine return uses to resolve its batch. They are PASSIVE provenance carried in the
 * sale line's own metadata: reading them never restores stock, creates a void or a return, or changes any
 * amount — those only happen through the existing, guarded void/return actions. Only valid non-empty strings
 * are written or read; anything else (null, a number, an object, an empty string) is "no provenance", never a
 * guessed batch.
 */
export const PHARMACY_BATCH_PROVENANCE_KEYS = ["pharmacyBatchOverrideId", "pharmacyBatchNumber", "pharmacyBatchExpiry"] as const;
type PharmacyBatchProvenanceKey = (typeof PHARMACY_BATCH_PROVENANCE_KEYS)[number];

const provenanceString = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

/** The metadata entries to write for a line: exactly the provenance fields that hold a valid string. */
export function pharmacyBatchProvenanceMetadata(line: Partial<Pick<SaleLine, PharmacyBatchProvenanceKey>>): Partial<Record<PharmacyBatchProvenanceKey, string>> {
  const out: Partial<Record<PharmacyBatchProvenanceKey, string>> = {};
  for (const key of PHARMACY_BATCH_PROVENANCE_KEYS) {
    const value = provenanceString(line[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The provenance to set on a decoded line: only valid strings from the line's metadata, never anything else. */
export function decodePharmacyBatchProvenance(meta: Record<string, unknown> | null | undefined): Partial<Pick<SaleLine, PharmacyBatchProvenanceKey>> {
  const out: Partial<Pick<SaleLine, PharmacyBatchProvenanceKey>> = {};
  if (!meta || typeof meta !== "object") return out;
  for (const key of PHARMACY_BATCH_PROVENANCE_KEYS) {
    const value = provenanceString(meta[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Encode a sale line for cloud push (mirrors cloudSync push payload). */
export function encodeSaleLineForCloud(line: SaleLine, idx = 0): CloudSaleLineRow {
  return {
    id: line.id,
    product_id: line.productId,
    quantity: line.quantity,
    unit_price_ugx: line.unitPriceUgx,
    line_discount_ugx: line.discountUgx ?? Math.max(0, (line.originalLineTotalUgx ?? line.lineTotalUgx) - line.lineTotalUgx),
    line_total_ugx: line.lineTotalUgx,
    line_input_mode: line.inputMode === "money" ? "money" : "quantity",
    money_amount_ugx: line.moneyAmountUgx ?? null,
    metadata: {
      name: line.name,
      unitCostUgx: line.unitCostUgx,
      cogsUgx: line.cogsUgx,
      cartDiscountUgx: line.cartDiscountUgx,
      netRevenueUgx: line.netRevenueUgx,
      grossProfitUgx: line.grossProfitUgx,
      baseUnit: line.baseUnit,
      estimatedProfitUgx: line.estimatedProfitUgx,
      updatedAt: line.updatedAt,
      lineIndex: idx,
      ...(Array.isArray(line.ingredientConsumption) ? { ingredientConsumption: line.ingredientConsumption } : {}),
      ...(Array.isArray(line.prepAllocation) && line.prepAllocation.length > 0 ? { prepAllocation: line.prepAllocation } : {}),
      ...pharmacyBatchProvenanceMetadata(line),
    },
  };
}

/** Made-to-order provenance from line metadata; anything malformed reads as "no provenance". */
function decodeIngredientConsumption(raw: unknown): SaleLine["ingredientConsumption"] {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<{ productId: string; quantity: number }> = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") return undefined;
    const productId = String((e as Record<string, unknown>).productId ?? "");
    const quantity = Number((e as Record<string, unknown>).quantity);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) return undefined;
    out.push({ productId, quantity });
  }
  return out;
}

/**
 * Batch-prepared provenance from line metadata: which PrepBatches this line's portions were taken from.
 * A prepared sale consumes exactly its quantity, so a valid allocation is a list of positive
 * {batchId, portions} that sums to the line quantity. Anything else — a different total, a non-positive
 * amount, a malformed entry — reads as "no provenance" (the previous behaviour), never as a guess.
 */
export function decodePrepAllocation(raw: unknown, lineQuantity: number): SaleLine["prepAllocation"] {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: Array<{ batchId: string; portions: number }> = [];
  let total = 0;
  for (const e of raw) {
    if (!e || typeof e !== "object") return undefined;
    const rawBatchId = (e as Record<string, unknown>).batchId;
    const portions = (e as Record<string, unknown>).portions;
    if (typeof rawBatchId !== "string" || typeof portions !== "number") return undefined;
    const batchId = rawBatchId.trim();
    if (!batchId || !Number.isFinite(portions) || portions <= 0) return undefined;
    out.push({ batchId, portions });
    total += portions;
  }
  if (Math.abs(total - Number(lineQuantity)) > 0.001) return undefined;
  return out;
}

/** Decode a cloud sale line row (mirrors cloudSync rowToSaleLine). */
export function decodeSaleLineFromCloud(row: CloudSaleLineRow): SaleLine {
  const inputMode = row.line_input_mode === "money" ? "money" : "quantity";
  const quantity = Number(row.quantity ?? 0);
  const unitPriceUgx = Math.max(0, Math.floor(Number(row.unit_price_ugx ?? 0)));
  const lineTotalUgx = Math.max(0, Math.floor(Number(row.line_total_ugx ?? 0)));
  const lineDiscountRaw = Math.max(0, Math.floor(Number(row.line_discount_ugx ?? 0)));
  const meta = row.metadata ?? {};
  const cogsUgx = meta.cogsUgx != null ? Math.max(0, Math.floor(Number(meta.cogsUgx))) : undefined;
  const cartDiscountUgx =
    meta.cartDiscountUgx != null ? Math.max(0, Math.floor(Number(meta.cartDiscountUgx))) : undefined;
  const netRevenueUgx =
    meta.netRevenueUgx != null ? Math.max(0, Math.floor(Number(meta.netRevenueUgx))) : undefined;
  const grossProfitUgx =
    meta.grossProfitUgx != null ? Math.floor(Number(meta.grossProfitUgx)) : undefined;
  const estimatedProfitRaw =
    grossProfitUgx ??
    (meta.estimatedProfitUgx != null ? Math.floor(Number(meta.estimatedProfitUgx)) : undefined);
  const line: SaleLine = {
    id: row.id != null ? String(row.id) : undefined,
    updatedAt: meta.updatedAt != null ? String(meta.updatedAt) : undefined,
    productId: String(row.product_id ?? ""),
    name: String(meta.name ?? "Item"),
    inputMode,
    quantity,
    unitPriceUgx,
    unitCostUgx: meta.unitCostUgx != null ? normalizeUnitCostUgx(Number(meta.unitCostUgx)) : 0,
    lineTotalUgx,
    cogsUgx,
    cartDiscountUgx,
    netRevenueUgx,
    grossProfitUgx,
    baseUnit: meta.baseUnit != null ? String(meta.baseUnit) : undefined,
    estimatedProfitUgx:
      estimatedProfitRaw != null
        ? Math.max(0, Math.floor(Number(estimatedProfitRaw)))
        : cogsUgx != null
          ? Math.max(0, Math.floor(lineTotalUgx - cogsUgx))
          : 0,
    moneyAmountUgx: row.money_amount_ugx != null ? Math.floor(Number(row.money_amount_ugx)) : null,
  };
  const consumption = decodeIngredientConsumption(meta.ingredientConsumption);
  if (consumption) line.ingredientConsumption = consumption;
  const prepAllocation = decodePrepAllocation(meta.prepAllocation, quantity);
  if (prepAllocation) line.prepAllocation = prepAllocation;
  Object.assign(line, decodePharmacyBatchProvenance(meta));
  if (lineDiscountRaw > 0) {
    line.discountUgx = lineDiscountRaw;
    line.originalLineTotalUgx = lineTotalUgx + lineDiscountRaw;
  }
  return ensureSaleLineId(line);
}

/** Round-trip a sale line through cloud encode/decode. */
export function roundTripSaleLineThroughCloud(line: SaleLine): SaleLine {
  return decodeSaleLineFromCloud(encodeSaleLineForCloud(line));
}
