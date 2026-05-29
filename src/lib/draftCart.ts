import type { Product, SaleLine } from "../types";
import { lineDiscountUgx, listPriceForLine } from "./saleAdjustments";
import {
  baseUnitsPerBuyingUnit,
  buildSaleLine,
  packLabelFromProduct,
  pricePerBaseUnitUgx,
} from "./sellingEngine";
import { formatFriendlyQuantity } from "./saleQuantityLabel";

/** Aggregates for wholesale / large-order checkout UI. */
export type DraftCartStats = {
  productCount: number;
  unitCount: number;
  totalUgx: number;
};

export function computeDraftCartStats(lines: SaleLine[]): DraftCartStats {
  let unitCount = 0;
  let totalUgx = 0;
  for (const line of lines) {
    unitCount += line.quantity;
    totalUgx += line.lineTotalUgx;
  }
  return {
    productCount: lines.length,
    unitCount: Math.round(unitCount * 10000) / 10000,
    totalUgx,
  };
}

/** Human-readable quantity on a cart line (pieces vs full packs). */
export function formatDraftLineQty(product: Product, line: SaleLine): string {
  const qty = line.quantity;
  const unit = product.baseUnit || "ea";
  const rate = baseUnitsPerBuyingUnit(product);
  const pack = packLabelFromProduct(product);

  if (rate > 1 && pack && qty >= rate) {
    const fullPacks = Math.floor(qty / rate);
    const remainder = Math.round((qty - fullPacks * rate) * 10000) / 10000;
    if (remainder <= 0) {
      const packLabel = fullPacks === 1 ? pack : `${pack}s`;
      return `${fullPacks} ${packLabel}`;
    }
    const packPart = fullPacks > 0 ? `${fullPacks} ${fullPacks === 1 ? pack : `${pack}s`} + ` : "";
    const pieceShown = Number.isInteger(remainder) ? String(remainder) : remainder.toFixed(2).replace(/\.?0+$/, "");
    return `${packPart}${pieceShown} ${unit}`;
  }

  return formatFriendlyQuantity(qty, unit, "short");
}

/** Rebuild a quantity line; scales an existing line discount proportionally. */
export function rebuildDraftLineQuantity(
  product: Product,
  quantity: number,
  prior?: SaleLine,
): SaleLine | null {
  const built = buildSaleLine(product, "quantity", quantity);
  if (!built.line) return null;
  const line = built.line;
  if (!prior || lineDiscountUgx(prior) <= 0) return line;

  const oldList = listPriceForLine(prior);
  const newList = line.lineTotalUgx;
  const ratio = oldList > 0 ? newList / oldList : 1;
  const discount = Math.round(lineDiscountUgx(prior) * ratio);
  const lineTotalUgx = Math.max(0, newList - discount);
  return {
    ...line,
    inputMode: "quantity",
    originalLineTotalUgx: newList,
    discountUgx: discount,
    lineTotalUgx,
    estimatedProfitUgx: Math.round(lineTotalUgx - quantity * line.unitCostUgx),
    moneyAmountUgx: null,
  };
}

/** Combine duplicate product adds into one cart line (additive quantity). */
export function mergeDraftSaleLine(
  existing: SaleLine | undefined,
  incoming: SaleLine,
  product: Product,
): SaleLine {
  if (!existing) return incoming;
  const totalQty = existing.quantity + incoming.quantity;
  return rebuildDraftLineQuantity(product, totalQty, existing) ?? incoming;
}

/** +/- on cart lines always moves by one base unit (1 bottle, 1 kg, …). Use presets or qty popup for crates/sacks. */
export function draftLineQuantityStep(_product: Product, backwards: boolean): number {
  return backwards ? -1 : 1;
}

export function formatDraftLineUnitPrice(product: Product, line: SaleLine): string {
  const price = line.unitPriceUgx || pricePerBaseUnitUgx(product);
  const unit = product.baseUnit || "ea";
  return `${price.toLocaleString()} / ${unit}`;
}
