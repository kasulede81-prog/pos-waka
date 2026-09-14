/**
 * UGX cost & profit precision.
 *
 * Pack-priced products use integer slot allocation: each parent pack's total
 * child-unit COGS sums exactly to buyingPackCostUgx (remainder on first slots).
 */

export function normalizeUnitCostUgx(raw: number | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function normalizePackCostUgx(raw: number | null | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Fractional-quantity sales (e.g. 2.5 kg) leave the pack depleted by a
 * fractional amount (e.g. slot 3.5) — flooring here would silently discard
 * that progress and misalign the very next sale's slot boundary. Only
 * clamps NaN/negative to 0; does not round.
 */
export function resolvePackCostUnitsDepleted(product: { packCostUnitsDepleted?: number | null }): number {
  const n = Number(product.packCostUnitsDepleted);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Exact unit cost from pack invoice ÷ pieces (no truncation). */
export function unitCostFromPackTotal(packCostUgx: number, unitsPerPack: number): number {
  const pack = normalizePackCostUgx(packCostUgx);
  const units = Math.max(1, Math.floor(unitsPerPack));
  if (pack <= 0) return 0;
  return pack / units;
}

/** Unit cost from invoice total ÷ base units (pharmacy receive / opening stock). */
export function unitCostFromInvoiceTotal(totalInvoiceUgx: number, totalBaseUnits: number): number {
  const total = Math.max(0, Math.floor(totalInvoiceUgx));
  const units = Math.max(0, Math.floor(totalBaseUnits));
  if (units <= 0) return 0;
  return total / units;
}

/** Profit per sell unit (UGX). */
export function profitPerUnitUgx(sellPriceUgx: number, unitCostUgx: number): number | null {
  const sell = Math.max(0, Math.floor(sellPriceUgx));
  const cost = normalizeUnitCostUgx(unitCostUgx);
  if (sell <= 0 || cost < 0) return null;
  return sell - cost;
}

/** Margin on sell price (retail standard): ((sell − cost) / sell) × 100. */
export function marginPercentOnSell(sellPriceUgx: number, unitCostUgx: number): number | null {
  const sell = Math.max(0, Math.floor(sellPriceUgx));
  const cost = normalizeUnitCostUgx(unitCostUgx);
  if (sell <= 0) return null;
  return Math.round(((sell - cost) / sell) * 1000) / 10;
}

/** Markup on cost (pharmacy reports): ((sell − cost) / cost) × 100. */
export function markupPercentOnCost(sellPriceUgx: number, unitCostUgx: number): number | null {
  const sell = Math.max(0, Math.floor(sellPriceUgx));
  const cost = normalizeUnitCostUgx(unitCostUgx);
  if (cost <= 0) return null;
  return Math.round(((sell - cost) / cost) * 100);
}

/** Round UGX for display, receipts, and export labels only. */
export function formatUgxDisplay(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount);
}

/** Line COGS from exact unit cost × quantity (non-pack products). */
export function lineCostUgx(unitCostUgx: number, quantity: number): number {
  const qty = Math.max(0, Number(quantity) || 0);
  if (qty <= 0) return 0;
  return Math.round(qty * normalizeUnitCostUgx(unitCostUgx));
}

/** Integer UGX for one slot inside a pack; sum of all slots = packCostUgx. */
export function packSlotUnitCostUgx(packCostUgx: number, unitsPerPack: number, slotIndex: number): number {
  const pack = normalizePackCostUgx(packCostUgx);
  const units = Math.max(1, Math.floor(unitsPerPack));
  if (pack <= 0) return 0;
  const slot = Math.floor(slotIndex) % units;
  const base = Math.floor(pack / units);
  const remainder = pack - base * units;
  return slot < remainder ? base + 1 : base;
}

/**
 * FIFO slot COGS — 24 separate unit sales sum exactly to packCostUgx.
 *
 * `startSlot`/`quantity` may be fractional (e.g. 2.5 kg sold starting at
 * slot 3.5). Each integer-indexed slot has a constant per-unit cost rate
 * (`packSlotUnitCostUgx`); a fractional quantity consumes a proportional
 * fraction of whichever slot(s) the continuous range
 * [startSlot, startSlot + quantity) overlaps — it must NOT be rounded up
 * to a whole slot count (that overcharges every fractional-quantity sale,
 * e.g. charging a full 3rd slot for a 2.5-unit sale). Rounding is applied
 * once at the very end, matching `lineCostUgx` elsewhere in this file.
 *
 * For an integer `startSlot`/`quantity` this collapses to exactly the same
 * per-slot summation as a whole-unit loop — each slot is either fully
 * included or fully excluded, never partially — so existing whole-unit
 * behavior is unchanged.
 */
export function lineCostFromPackSlots(
  packCostUgx: number,
  unitsPerPack: number,
  startSlot: number,
  quantity: number,
): number {
  const qty = Math.max(0, Number(quantity) || 0);
  if (qty <= 0) return 0;
  const start = Math.max(0, Number(startSlot) || 0);
  const EPSILON = 1e-9;
  let cursor = start;
  let remaining = qty;
  let total = 0;
  while (remaining > EPSILON) {
    const slotIndex = Math.floor(cursor);
    const take = Math.min(remaining, slotIndex + 1 - cursor);
    total += take * packSlotUnitCostUgx(packCostUgx, unitsPerPack, slotIndex);
    cursor += take;
    remaining -= take;
  }
  return Math.round(total);
}

/** @deprecated Use lineCostFromPackSlots — proportional round drifts per-unit sales. */
export function lineCostFromPackAllocation(
  packCostUgx: number,
  unitsPerPack: number,
  quantityBaseUnits: number,
): number {
  const pack = normalizePackCostUgx(packCostUgx);
  const units = Math.max(1, Math.floor(unitsPerPack));
  const qty = Math.max(0, Number(quantityBaseUnits) || 0);
  if (pack <= 0 || qty <= 0) return 0;
  return lineCostFromPackSlots(pack, units, 0, qty);
}

export function unitsPerPackFromProduct(product: { conversionRate?: number | null }): number | null {
  const r = product.conversionRate;
  if (r == null || r <= 1 || Number.isNaN(r)) return null;
  return r;
}

export function buyingPackCostUgxForProduct(product: {
  buyingPackCostUgx?: number | null;
  costPricePerUnitUgx: number;
  conversionRate?: number | null;
}): number | null {
  if (product.buyingPackCostUgx != null && product.buyingPackCostUgx > 0) {
    return normalizePackCostUgx(product.buyingPackCostUgx);
  }
  const units = unitsPerPackFromProduct(product);
  if (units == null) return null;
  const cost = normalizeUnitCostUgx(product.costPricePerUnitUgx);
  if (cost <= 0) return null;
  const derived = cost * units;
  return derived > 0 ? Math.round(derived) : null;
}

export function hasPackCostAllocation(product: {
  buyingPackCostUgx?: number | null;
  costPricePerUnitUgx: number;
  conversionRate?: number | null;
}): boolean {
  const packCost = buyingPackCostUgxForProduct(product);
  const units = unitsPerPackFromProduct(product);
  return packCost != null && units != null;
}

export function costPerBaseUnitUgxFromProduct(product: { costPricePerUnitUgx: number }): number {
  return normalizeUnitCostUgx(product.costPricePerUnitUgx);
}

/** COGS for a quantity — slot FIFO when pack metadata exists. */
export function lineCostForProductQuantity(
  product: {
    costPricePerUnitUgx: number;
    buyingPackCostUgx?: number | null;
    conversionRate?: number | null;
    packCostUnitsDepleted?: number | null;
  },
  quantity: number,
  unitCostOverride?: number,
  packSlotStartOverride?: number,
): number {
  const qty = Math.max(0, Number(quantity) || 0);
  if (qty <= 0) return 0;

  const packCost = buyingPackCostUgxForProduct(product);
  const units = unitsPerPackFromProduct(product);
  if (packCost != null && units != null) {
    const startSlot = packSlotStartOverride ?? resolvePackCostUnitsDepleted(product);
    return lineCostFromPackSlots(packCost, units, startSlot, qty);
  }

  const unitCost =
    unitCostOverride != null && Number.isFinite(unitCostOverride) && unitCostOverride >= 0
      ? normalizeUnitCostUgx(unitCostOverride)
      : costPerBaseUnitUgxFromProduct(product);
  return lineCostUgx(unitCost, qty);
}

export function lineProfitUgx(revenueUgx: number, costUgx: number): number {
  return Math.round(revenueUgx - costUgx);
}

/** COGS from a finalized sale line (uses snapshotted cogs/profit, not live pack slot counter). */
export function lineCostFromSaleLine(line: {
  quantity: number;
  lineTotalUgx: number;
  unitCostUgx?: number;
  estimatedProfitUgx?: number;
  cogsUgx?: number;
  netRevenueUgx?: number;
  grossProfitUgx?: number;
}): number {
  const qty = Math.max(0, Number(line.quantity) || 0);
  if (qty <= 0) return 0;
  if (Number.isFinite(line.cogsUgx) && line.cogsUgx! >= 0) {
    return Math.round(line.cogsUgx!);
  }
  const revenue = Number.isFinite(line.netRevenueUgx) ? line.netRevenueUgx! : line.lineTotalUgx;
  const profit = Number.isFinite(line.grossProfitUgx)
    ? Math.round(line.grossProfitUgx!)
    : Number.isFinite(line.estimatedProfitUgx)
      ? Math.round(Number(line.estimatedProfitUgx))
      : null;
  if (profit != null) {
    return Math.round(revenue - profit);
  }
  return lineCostUgx(normalizeUnitCostUgx(line.unitCostUgx), qty);
}

/**
 * Current on-hand inventory value for ONE product — deliberately NOT routed
 * through `lineCostForProductQuantity`/`buyingPackCostUgxForProduct`.
 *
 * Those functions exist for SALE-LINE COGS, where a pack-priced product's
 * FIFO slot allocation must sum exactly to its buying-pack invoice total —
 * `buyingPackCostUgx` is the right source of truth there. But `recordPurchase`
 * (usePosStore.ts) only recomputes `costPricePerUnitUgx` on restock and never
 * touches `buyingPackCostUgx`, so that field can silently go stale relative
 * to the live unit cost. Routing inventory VALUATION through the same
 * pack-cost-preferring path meant "Stock value" (and every other consumer of
 * this function — Stock page, Receipts, Monthly Business Report, Finance
 * Diagnostics, cloud recovery/trust-center reporting) could understate a
 * pack-priced product's value using a stale invoice figure instead of its
 * current per-unit cost, even though the Products table/export — which read
 * `costPricePerUnitUgx` directly — showed the correct number.
 *
 * Inventory valuation and sale COGS are different questions ("what is this
 * stock worth right now" vs "what did this specific sale actually cost,
 * FIFO-allocated against the invoice it came from") and deliberately use
 * different formulas. This function answers only the first one, always from
 * the current live unit cost — matching the Products table/CSV export.
 */
export function inventoryLineValueAtCostUgx(product: {
  stockOnHand: number;
  costPricePerUnitUgx: number;
}): number {
  const stock = Math.max(0, Number(product.stockOnHand) || 0);
  if (stock <= 0) return 0;
  return lineCostUgx(costPerBaseUnitUgxFromProduct(product), stock);
}

export function inventoryValueAtCostUgx(
  products: Array<{
    stockOnHand: number;
    costPricePerUnitUgx: number;
  }>,
): number {
  return products.reduce((sum, p) => sum + inventoryLineValueAtCostUgx(p), 0);
}

export function advancePackCostUnitsDepleted(current: number | null | undefined, quantity: number): number {
  return resolvePackCostUnitsDepleted({ packCostUnitsDepleted: current }) + Math.max(0, Number(quantity) || 0);
}

export function retractPackCostUnitsDepleted(current: number | null | undefined, quantity: number): number {
  const retract = Math.max(0, Number(quantity) || 0);
  return Math.max(0, resolvePackCostUnitsDepleted({ packCostUnitsDepleted: current }) - retract);
}

export function applyPackSlotCostsToSaleLine(
  product: {
    costPricePerUnitUgx: number;
    buyingPackCostUgx?: number | null;
    conversionRate?: number | null;
    packCostUnitsDepleted?: number | null;
  },
  line: { quantity: number; lineTotalUgx: number },
  packSlotStart: number,
): { unitCostUgx: number; estimatedProfitUgx: number } {
  const qty = Math.max(0, Number(line.quantity) || 0);
  const cost = lineCostForProductQuantity(product, qty, undefined, packSlotStart);
  const unitCostUgx = qty > 0 ? cost / qty : normalizeUnitCostUgx(product.costPricePerUnitUgx);
  return {
    unitCostUgx,
    estimatedProfitUgx: lineProfitUgx(line.lineTotalUgx, cost),
  };
}

/** Weighted average unit cost after stock-in — keeps decimal precision (no premature round). */
export function weightedCostAfterStockInPrecise(
  prevStock: number,
  prevCostPerBaseUgx: number,
  incomingBaseUnits: number,
  incomingCostPerBaseUgx: number,
): number {
  const next = prevStock + incomingBaseUnits;
  if (next <= 0) return normalizeUnitCostUgx(incomingCostPerBaseUgx);
  const prev = Math.max(0, prevStock);
  const prevCost = normalizeUnitCostUgx(prevCostPerBaseUgx);
  const incomingCost = normalizeUnitCostUgx(incomingCostPerBaseUgx);
  const incoming = Math.max(0, incomingBaseUnits);
  return (prev * prevCost + incoming * incomingCost) / next;
}

/** Unit cost from buying-unit price (e.g. cost per crate → cost per bottle). */
export function costPerBaseFromBuyingUnitCostPrecise(
  unitsPerBuyingUnit: number,
  costPerBuyingUnitUgx: number,
): number {
  const per = Math.max(1, Math.floor(unitsPerBuyingUnit));
  const cost = normalizePackCostUgx(costPerBuyingUnitUgx);
  if (cost <= 0) return 0;
  return cost / per;
}
