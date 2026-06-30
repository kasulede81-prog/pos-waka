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
    },
  };
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
