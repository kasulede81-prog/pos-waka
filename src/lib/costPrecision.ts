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

export function resolvePackCostUnitsDepleted(product: { packCostUnitsDepleted?: number | null }): number {
  const n = Number(product.packCostUnitsDepleted);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Exact unit cost from pack invoice ÷ pieces (no truncation). */
export function unitCostFromPackTotal(packCostUgx: number, unitsPerPack: number): number {
  const pack = normalizePackCostUgx(packCostUgx);
  const units = Math.max(1, Math.floor(unitsPerPack));
  if (pack <= 0) return 0;
  return pack / units;
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

/** FIFO slot COGS — 24 separate unit sales sum exactly to packCostUgx. */
export function lineCostFromPackSlots(
  packCostUgx: number,
  unitsPerPack: number,
  startSlot: number,
  quantity: number,
): number {
  const qty = Math.max(0, Number(quantity) || 0);
  if (qty <= 0) return 0;
  const start = Math.max(0, Math.floor(startSlot));
  let total = 0;
  for (let i = 0; i < qty; i++) {
    total += packSlotUnitCostUgx(packCostUgx, unitsPerPack, start + i);
  }
  return total;
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

/** COGS from a finalized sale line (uses snapshotted profit/cost, not live pack slot counter). */
export function lineCostFromSaleLine(line: {
  quantity: number;
  lineTotalUgx: number;
  unitCostUgx?: number;
  estimatedProfitUgx?: number;
}): number {
  const qty = Math.max(0, Number(line.quantity) || 0);
  if (qty <= 0) return 0;
  if (Number.isFinite(line.estimatedProfitUgx)) {
    return line.lineTotalUgx - Math.round(Number(line.estimatedProfitUgx));
  }
  return lineCostUgx(normalizeUnitCostUgx(line.unitCostUgx), qty);
}

export function inventoryLineValueAtCostUgx(product: {
  stockOnHand: number;
  costPricePerUnitUgx: number;
  buyingPackCostUgx?: number | null;
  conversionRate?: number | null;
  packCostUnitsDepleted?: number | null;
}): number {
  const stock = Math.max(0, Number(product.stockOnHand) || 0);
  if (stock <= 0) return 0;
  return lineCostForProductQuantity(product, stock);
}

export function inventoryValueAtCostUgx(
  products: Array<{
    stockOnHand: number;
    costPricePerUnitUgx: number;
    buyingPackCostUgx?: number | null;
    conversionRate?: number | null;
    packCostUnitsDepleted?: number | null;
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
