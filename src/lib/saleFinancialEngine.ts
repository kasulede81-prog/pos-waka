/**
 * Single source of truth for sale-line financial snapshots and reporting reads.
 * Completed sales must never depend on live product prices for profit/COGS.
 */

import type { LineInputMode, Product, ReturnRecord, Sale, SaleLine } from "../types";
import {
  applyPackSlotCostsToSaleLine,
  lineCostFromSaleLine,
  lineCostUgx,
  lineProfitUgx,
  normalizeUnitCostUgx,
  resolvePackCostUnitsDepleted,
} from "./costPrecision";
import { quantityFromMoneyUgx } from "./sellingEngine";

export type SaleLineFinancials = {
  quantity: number;
  unitPriceUgx: number;
  unitCostUgx: number;
  listRevenueUgx: number;
  lineDiscountUgx: number;
  cartDiscountUgx: number;
  revenueUgx: number;
  cogsUgx: number;
  grossProfitUgx: number;
  totalDiscountUgx: number;
  inputMode: LineInputMode;
  baseUnit?: string;
};

export type SaleFinancialTotals = {
  listRevenueUgx: number;
  lineDiscountUgx: number;
  cartDiscountUgx: number;
  revenueUgx: number;
  cogsUgx: number;
  grossProfitUgx: number;
};

function lineListRevenueUgx(line: SaleLine): number {
  return Math.max(0, Math.floor(Number(line.originalLineTotalUgx ?? line.lineTotalUgx) || 0));
}

function lineDiscountAmountUgx(line: SaleLine): number {
  const list = lineListRevenueUgx(line);
  const paid = Math.max(0, Math.floor(Number(line.lineTotalUgx) || 0));
  return Math.max(0, list - paid);
}

/** Proportional cart-discount shares; last line absorbs rounding remainder. */
export function allocateCartDiscountUgx(
  lineTotalsUgx: number[],
  cartDiscountUgx: number,
): number[] {
  const subtotal = lineTotalsUgx.reduce((a, v) => a + v, 0);
  const discount = Math.min(Math.max(0, Math.floor(cartDiscountUgx)), subtotal);
  if (discount <= 0 || subtotal <= 0) return lineTotalsUgx.map(() => 0);

  const shares: number[] = [];
  let allocated = 0;
  for (let i = 0; i < lineTotalsUgx.length; i++) {
    if (i === lineTotalsUgx.length - 1) {
      shares.push(discount - allocated);
    } else {
      const share = Math.round((discount * lineTotalsUgx[i]!) / subtotal);
      shares.push(share);
      allocated += share;
    }
  }
  return shares;
}

/** Persist money-sale quantity from amount ÷ unit price at finalize. */
export function ensureMoneySaleQuantity(line: SaleLine, product: Product): SaleLine {
  if (line.inputMode !== "money") return line;
  const unitPrice = Math.max(0, Math.floor(Number(line.unitPriceUgx) || 0));
  const amount = Math.max(0, Math.floor(Number(line.moneyAmountUgx ?? line.lineTotalUgx) || 0));
  if (unitPrice <= 0 || amount <= 0) return line;
  const quantity = quantityFromMoneyUgx(product, amount);
  return {
    ...line,
    quantity,
    lineTotalUgx: amount,
    moneyAmountUgx: amount,
    originalLineTotalUgx: line.originalLineTotalUgx ?? amount,
  };
}

/** Apply proportional cart discount and final profit snapshot to pre-cart lines. */
export function applyCartDiscountSnapshot(lines: SaleLine[], cartDiscountUgx: number): SaleLine[] {
  const lineTotals = lines.map((l) => Math.max(0, Math.floor(l.lineTotalUgx)));
  const cartShares = allocateCartDiscountUgx(lineTotals, cartDiscountUgx);

  return lines.map((line, i) => {
    const cartDiscount = cartShares[i] ?? 0;
    const netRevenueUgx = Math.max(0, line.lineTotalUgx - cartDiscount);
    const cogsUgx =
      Number.isFinite(line.cogsUgx) && line.cogsUgx! >= 0
        ? Math.round(line.cogsUgx!)
        : lineCostFromSaleLine(line);
    const grossProfitUgx = lineProfitUgx(netRevenueUgx, cogsUgx);
    return {
      ...line,
      cogsUgx,
      cartDiscountUgx: cartDiscount,
      netRevenueUgx,
      grossProfitUgx,
      estimatedProfitUgx: grossProfitUgx,
    };
  });
}

/** Snapshot COGS + cart allocation on every line at sale completion. */
export function finalizeSaleLineFinancials(
  draftLines: SaleLine[],
  products: Product[],
  cartDiscountUgx: number,
): SaleLine[] {
  const workingProducts = products.map((p) => ({ ...p }));
  const preCartLines: SaleLine[] = [];

  for (const line of draftLines) {
    const idx = workingProducts.findIndex((p) => p.id === line.productId);
    if (idx < 0) {
      preCartLines.push(line);
      continue;
    }
    const product = workingProducts[idx]!;
    const normalized = ensureMoneySaleQuantity(line, product);
    const slotStart = resolvePackCostUnitsDepleted(product);
    const slotCosts = applyPackSlotCostsToSaleLine(product, normalized, slotStart);
    const cogsUgx = lineCostUgx(slotCosts.unitCostUgx, normalized.quantity);
    preCartLines.push({
      ...normalized,
      unitCostUgx: slotCosts.unitCostUgx,
      cogsUgx,
      baseUnit: product.baseUnit?.trim() || undefined,
    });
    workingProducts[idx] = {
      ...product,
      packCostUnitsDepleted: slotStart + Math.max(0, normalized.quantity),
    };
  }

  return applyCartDiscountSnapshot(preCartLines, cartDiscountUgx);
}

export function saleEstimatedProfitUgx(lines: SaleLine[]): number {
  return Math.round(lines.reduce((sum, line) => sum + resolveSaleLineFinancials(line).grossProfitUgx, 0));
}

/** Read financial snapshot from a completed line — never uses live product cost when snapshotted. */
export function resolveSaleLineFinancials(
  line: SaleLine,
  saleContext?: { cartDiscountUgx?: number; lineSubtotalUgx?: number },
): SaleLineFinancials {
  const quantity = Math.max(0, Number(line.quantity) || 0);
  const unitPriceUgx = Math.max(0, Math.floor(Number(line.unitPriceUgx) || 0));
  const unitCostUgx = normalizeUnitCostUgx(line.unitCostUgx);
  const listRevenueUgx = lineListRevenueUgx(line);
  const lineDiscountUgx = lineDiscountAmountUgx(line);
  const preCartRevenueUgx = Math.max(0, Math.floor(Number(line.lineTotalUgx) || 0));

  if (line.financialDataStatus === "legacy" || line.financialDataStatus === "needs_repair") {
    const revenueUgx =
      Number.isFinite(line.netRevenueUgx) && line.netRevenueUgx! >= 0
        ? Math.floor(line.netRevenueUgx!)
        : preCartRevenueUgx;
    return {
      quantity,
      unitPriceUgx,
      unitCostUgx,
      listRevenueUgx: lineListRevenueUgx(line),
      lineDiscountUgx: lineDiscountAmountUgx(line),
      cartDiscountUgx: Math.max(0, Math.floor(Number(line.cartDiscountUgx) || 0)),
      revenueUgx,
      cogsUgx: 0,
      grossProfitUgx: 0,
      totalDiscountUgx: lineDiscountAmountUgx(line) + Math.max(0, Math.floor(Number(line.cartDiscountUgx) || 0)),
      inputMode: line.inputMode,
      baseUnit: line.baseUnit,
    };
  }

  const hasSnapshot =
    Number.isFinite(line.netRevenueUgx) &&
    Number.isFinite(line.cogsUgx) &&
    Number.isFinite(line.grossProfitUgx);

  let cartDiscountUgx = Math.max(0, Math.floor(Number(line.cartDiscountUgx) || 0));
  let revenueUgx = hasSnapshot ? Math.max(0, Math.floor(line.netRevenueUgx!)) : preCartRevenueUgx;
  let cogsUgx = hasSnapshot
    ? Math.max(0, Math.round(line.cogsUgx!))
    : lineCostFromSaleLine(line);
  let grossProfitUgx = hasSnapshot
    ? Math.round(line.grossProfitUgx!)
    : lineProfitUgx(revenueUgx, cogsUgx);

  if (!hasSnapshot && saleContext?.cartDiscountUgx != null && saleContext.cartDiscountUgx > 0) {
    const lineSubtotal = saleContext.lineSubtotalUgx ?? preCartRevenueUgx;
    if (lineSubtotal > 0) {
      cartDiscountUgx = Math.round((saleContext.cartDiscountUgx * preCartRevenueUgx) / lineSubtotal);
      revenueUgx = Math.max(0, preCartRevenueUgx - cartDiscountUgx);
      grossProfitUgx = lineProfitUgx(revenueUgx, cogsUgx);
    }
  } else if (!hasSnapshot && Number.isFinite(line.estimatedProfitUgx) && cartDiscountUgx <= 0) {
    grossProfitUgx = Math.round(line.estimatedProfitUgx);
    cogsUgx = lineCostFromSaleLine({ ...line, estimatedProfitUgx: grossProfitUgx });
  }

  const totalDiscountUgx = lineDiscountUgx + cartDiscountUgx;

  return {
    quantity,
    unitPriceUgx,
    unitCostUgx,
    listRevenueUgx,
    lineDiscountUgx,
    cartDiscountUgx,
    revenueUgx,
    cogsUgx,
    grossProfitUgx,
    totalDiscountUgx,
    inputMode: line.inputMode,
    baseUnit: line.baseUnit,
  };
}

export function resolveSaleLineFinancialsWithSale(line: SaleLine, sale: Sale): SaleLineFinancials {
  const active = sale.lines.filter((l) => !l.voided);
  const lineSubtotalUgx = active.reduce((a, l) => a + l.lineTotalUgx, 0);
  const heldTotal = Math.max(0, Math.floor(sale.totalUgx ?? 0));
  const cartDiscountUgx = Math.max(0, Math.min(lineSubtotalUgx, lineSubtotalUgx - heldTotal));
  return resolveSaleLineFinancials(line, { cartDiscountUgx, lineSubtotalUgx });
}

export function sumSaleLinesFinancials(
  lines: SaleLine[],
  saleContext?: { cartDiscountUgx?: number; lineSubtotalUgx?: number },
): SaleFinancialTotals {
  let listRevenueUgx = 0;
  let lineDiscountUgx = 0;
  let cartDiscountUgx = 0;
  let revenueUgx = 0;
  let cogsUgx = 0;
  let grossProfitUgx = 0;

  for (const line of lines) {
    if (line.voided) continue;
    const fin = resolveSaleLineFinancials(line, saleContext);
    listRevenueUgx += fin.listRevenueUgx;
    lineDiscountUgx += fin.lineDiscountUgx;
    cartDiscountUgx += fin.cartDiscountUgx;
    revenueUgx += fin.revenueUgx;
    cogsUgx += fin.cogsUgx;
    grossProfitUgx += fin.grossProfitUgx;
  }

  return {
    listRevenueUgx,
    lineDiscountUgx,
    cartDiscountUgx,
    revenueUgx,
    cogsUgx,
    grossProfitUgx: Math.round(grossProfitUgx),
  };
}

export function sumSalesFinancials(sales: Sale[]): SaleFinancialTotals {
  let totals: SaleFinancialTotals = {
    listRevenueUgx: 0,
    lineDiscountUgx: 0,
    cartDiscountUgx: 0,
    revenueUgx: 0,
    cogsUgx: 0,
    grossProfitUgx: 0,
  };
  for (const sale of sales) {
    const active = sale.lines.filter((l) => !l.voided);
    const lineSubtotalUgx = active.reduce((a, l) => a + l.lineTotalUgx, 0);
    const heldTotal = Math.max(0, Math.floor(sale.totalUgx ?? 0));
    const cartDiscountUgx = Math.max(0, Math.min(lineSubtotalUgx, lineSubtotalUgx - heldTotal));
    const part = sumSaleLinesFinancials(active, { cartDiscountUgx, lineSubtotalUgx });
    totals = {
      listRevenueUgx: totals.listRevenueUgx + part.listRevenueUgx,
      lineDiscountUgx: totals.lineDiscountUgx + part.lineDiscountUgx,
      cartDiscountUgx: totals.cartDiscountUgx + part.cartDiscountUgx,
      revenueUgx: totals.revenueUgx + part.revenueUgx,
      cogsUgx: totals.cogsUgx + part.cogsUgx,
      grossProfitUgx: totals.grossProfitUgx + part.grossProfitUgx,
    };
  }
  return { ...totals, grossProfitUgx: Math.round(totals.grossProfitUgx) };
}

export type ReturnFinancials = {
  refundUgx: number;
  quantity: number;
  cogsUgx: number;
  grossProfitUgx: number;
  unitCostUgx: number;
};

/** COGS reversed from original sale line snapshot — never live product cost. */
export function resolveReturnCogsFromSaleLine(line: SaleLine, returnQty: number): number {
  const qty = Math.max(0, Number(returnQty) || 0);
  if (qty <= 0) return 0;
  const lineQty = Math.max(0, Number(line.quantity) || 0);
  if (lineQty <= 0) return 0;

  const fin = resolveSaleLineFinancials(line);
  if (qty >= lineQty) return fin.cogsUgx;
  return Math.round((fin.cogsUgx / lineQty) * qty);
}

export function resolveReturnFinancials(
  rec: ReturnRecord,
  saleLine?: SaleLine | null,
): ReturnFinancials {
  const refundUgx = Math.max(0, Math.floor(rec.refundAmountUgx));
  const quantity = Math.max(0, Number(rec.quantity) || 0);

  if (Number.isFinite(rec.cogsUgx) && rec.cogsUgx! >= 0) {
    const cogsUgx = Math.round(rec.cogsUgx!);
    const unitCostUgx =
      quantity > 0
        ? normalizeUnitCostUgx(rec.unitCostUgx ?? cogsUgx / quantity)
        : normalizeUnitCostUgx(rec.unitCostUgx);
    return {
      refundUgx,
      quantity,
      cogsUgx,
      grossProfitUgx: lineProfitUgx(refundUgx, cogsUgx),
      unitCostUgx,
    };
  }

  if (saleLine) {
    const cogsUgx = resolveReturnCogsFromSaleLine(saleLine, quantity);
    const fin = resolveSaleLineFinancials(saleLine);
    const unitCostUgx = fin.unitCostUgx;
    return {
      refundUgx,
      quantity,
      cogsUgx,
      grossProfitUgx: lineProfitUgx(refundUgx, cogsUgx),
      unitCostUgx,
    };
  }

  return {
    refundUgx,
    quantity,
    cogsUgx: 0,
    grossProfitUgx: refundUgx,
    unitCostUgx: 0,
  };
}

export function findSaleLineForReturn(sale: Sale | undefined, productId: string): SaleLine | null {
  if (!sale) return null;
  const match = sale.lines.find((l) => !l.voided && l.productId === productId);
  return match ?? null;
}

/** @deprecated Use saleEstimatedProfitUgx — kept for draftCart import compatibility. */
export function estimatedProfitAfterCartDiscount(lines: SaleLine[], cartDiscountUgx = 0): number {
  if (cartDiscountUgx <= 0) {
    return Math.round(lines.reduce((a, l) => a + (l.estimatedProfitUgx ?? 0), 0));
  }
  const snapshotted = lines.every(
    (l) => Number.isFinite(l.grossProfitUgx) && Number.isFinite(l.netRevenueUgx),
  );
  if (snapshotted) return saleEstimatedProfitUgx(lines);

  const lineSubtotalUgx = lines.reduce((a, l) => a + l.lineTotalUgx, 0);
  const rawProfit = lines.reduce((a, l) => a + l.estimatedProfitUgx, 0);
  if (lineSubtotalUgx <= 0) return rawProfit;
  const netRatio = Math.max(0, lineSubtotalUgx - cartDiscountUgx) / lineSubtotalUgx;
  return Math.round(rawProfit * netRatio);
}
