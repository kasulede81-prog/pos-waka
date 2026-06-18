import type { Product, Sale, SaleLine } from "../types";
import { ensureSaleLineId } from "./pendingSaleMerge";
import { lineDiscountUgx, listPriceForLine } from "./saleAdjustments";
import {
  baseUnitsPerBuyingUnit,
  buildSaleLine,
  packLabelFromProduct,
  pricePerBaseUnitUgx,
} from "./sellingEngine";
import { formatPharmacySaleQtyLabel, isPharmacyPackagingActive } from "./pharmacyPackaging";
import { formatFriendlyQuantity } from "./saleQuantityLabel";

/** Aggregates for wholesale / large-order checkout UI. */
export type DraftCartStats = {
  productCount: number;
  unitCount: number;
  totalUgx: number;
};

export type DraftCheckoutTotals = {
  lineSubtotalUgx: number;
  lineDiscountUgx: number;
  cartDiscountUgx: number;
  payableUgx: number;
};

/** Line subtotal, line discounts, optional cart discount, final payable. */
export function computeDraftCheckoutTotals(lines: SaleLine[], cartDiscountUgx = 0): DraftCheckoutTotals {
  let lineSubtotalUgx = 0;
  let lineDiscountUgx = 0;
  for (const line of lines) {
    const list = line.originalLineTotalUgx ?? line.lineTotalUgx;
    lineSubtotalUgx += line.lineTotalUgx;
    lineDiscountUgx += Math.max(0, list - line.lineTotalUgx);
  }
  const cartDiscount = Math.min(Math.max(0, Math.floor(cartDiscountUgx)), lineSubtotalUgx);
  return {
    lineSubtotalUgx,
    lineDiscountUgx,
    cartDiscountUgx: cartDiscount,
    payableUgx: Math.max(0, lineSubtotalUgx - cartDiscount),
  };
}

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

/** @deprecated Prefer computeDraftCheckoutTotals for checkout display. */
export function draftPayableTotal(lines: SaleLine[], cartDiscountUgx = 0): number {
  return computeDraftCheckoutTotals(lines, cartDiscountUgx).payableUgx;
}

/** Scale aggregate line profit when a cart-level discount reduces net revenue. */
export function estimatedProfitAfterCartDiscount(lines: SaleLine[], cartDiscountUgx = 0): number {
  const lineSubtotalUgx = lines.reduce((a, l) => a + l.lineTotalUgx, 0);
  const rawProfit = lines.reduce((a, l) => a + l.estimatedProfitUgx, 0);
  if (cartDiscountUgx <= 0 || lineSubtotalUgx <= 0) return rawProfit;
  const netRatio = Math.max(0, lineSubtotalUgx - cartDiscountUgx) / lineSubtotalUgx;
  return Math.round(rawProfit * netRatio);
}

/** Restore whole-cart discount from a held/pending sale so checkout totals match the held bill. */
export function cartDiscountFromPendingSale(sale: Sale): number {
  const lineSubtotalUgx = sale.lines.reduce((a, l) => a + l.lineTotalUgx, 0);
  const heldTotalUgx = Math.max(0, Math.floor(sale.totalUgx ?? 0));
  return Math.max(0, Math.min(lineSubtotalUgx, lineSubtotalUgx - heldTotalUgx));
}

/** Human-readable quantity on a cart line (pieces vs full packs). */
export function formatDraftLineQty(product: Product, line: SaleLine): string {
  if (isPharmacyPackagingActive(product)) {
    return formatPharmacySaleQtyLabel(product, line, "short");
  }
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
  const now = new Date().toISOString();
  const line = {
    ...built.line,
    id: prior?.id ?? built.line.id ?? crypto.randomUUID(),
    updatedAt: now,
    stockVersionAtAdd: product.version ?? 1,
  };
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
  if (!existing) {
    return { ...ensureSaleLineId(incoming), stockVersionAtAdd: product.version ?? 1 };
  }
  const totalQty = existing.quantity + incoming.quantity;
  const merged = rebuildDraftLineQuantity(product, totalQty, existing);
  if (merged) {
    return { ...merged, stockVersionAtAdd: existing.stockVersionAtAdd ?? product.version ?? 1 };
  }
  return { ...ensureSaleLineId(incoming), stockVersionAtAdd: product.version ?? 1 };
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
