import type { LineInputMode, Product, SaleLine } from "../types";

const MONEY_ROUND = 4;

/** UGX price per base unit used at the till (falls back to legacy mental model). */
export function pricePerBaseUnitUgx(product: Product): number {
  const p = product.sellingPricePerUnitUgx;
  return p > 0 ? p : 0;
}

export function costPerBaseUnitUgx(product: Product): number {
  const c = product.costPricePerUnitUgx;
  return c >= 0 ? c : 0;
}

/**
 * Customer pays `moneyUgx` only — derive quantity from shelf price.
 * Example: 1000 UGX at 10,000 UGX/litre → 0.1 litre.
 */
export function quantityFromMoneyUgx(product: Product, moneyUgx: number): number {
  const price = pricePerBaseUnitUgx(product);
  if (price <= 0 || moneyUgx <= 0) return 0;
  const q = moneyUgx / price;
  return Math.round(q * 10 ** MONEY_ROUND) / 10 ** MONEY_ROUND;
}

export function lineTotalFromQuantity(product: Product, quantity: number): number {
  return Math.round(quantity * pricePerBaseUnitUgx(product));
}

export function buildSaleLine(
  product: Product,
  inputMode: LineInputMode,
  rawValue: number,
): { line: SaleLine | null; error?: string } {
  const price = pricePerBaseUnitUgx(product);
  if (price <= 0) {
    return { line: null, error: "noPrice" };
  }

  if (inputMode === "money") {
    const money = Math.floor(rawValue);
    if (money <= 0) return { line: null, error: "invalidMoney" };
    const qty = quantityFromMoneyUgx(product, money);
    if (qty <= 0) return { line: null, error: "qtyZero" };
    return {
      line: {
        productId: product.id,
        name: product.name,
        inputMode: "money",
        quantity: qty,
        unitPriceUgx: price,
        lineTotalUgx: money,
        moneyAmountUgx: money,
      },
    };
  }

  const qty = Math.round(rawValue * 10 ** MONEY_ROUND) / 10 ** MONEY_ROUND;
  if (qty <= 0) return { line: null, error: "invalidQty" };
  return {
    line: {
      productId: product.id,
      name: product.name,
      inputMode: "quantity",
      quantity: qty,
      unitPriceUgx: price,
      lineTotalUgx: lineTotalFromQuantity(product, qty),
      moneyAmountUgx: null,
    },
  };
}

/** Gross margin for one line: line total minus quantity × `costPricePerUnitUgx` (your buying cost per base unit). */
export function estimatedProfitForLine(product: Product, line: SaleLine): number {
  const cost = costPerBaseUnitUgx(product);
  const profit = line.lineTotalUgx - line.quantity * cost;
  return Math.round(profit);
}

export function lowStockThreshold(product: Product): number {
  const m = product.minimumStockAlert;
  return m > 0 ? m : 0;
}

export function isLowStock(product: Product): boolean {
  const t = lowStockThreshold(product);
  return t > 0 && product.stockOnHand <= t;
}

export function formatStockLabel(product: Product): string {
  const u = product.baseUnit || "ea";
  const n = Number(product.stockOnHand);
  const shown = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
  return `${shown} ${u}`;
}

/** How many base units (kg, bottles, …) one buying unit (sack, crate, jerrican) contains. */
export function baseUnitsPerBuyingUnit(product: Product): number {
  const r = product.conversionRate;
  if (r == null || r <= 0 || Number.isNaN(r)) return 1;
  return r;
}

/** Convert purchased packs into shelf (base) units. */
export function buyingUnitsToBaseUnits(product: Product, qtyBuyingUnits: number): number {
  return qtyBuyingUnits * baseUnitsPerBuyingUnit(product);
}

/** UGX cost per base unit from cost per buying unit (e.g. cost per sack → cost per kg). */
export function costPerBaseFromBuyingUnitCost(product: Product, costPerBuyingUnitUgx: number): number {
  const per = baseUnitsPerBuyingUnit(product);
  return Math.round(costPerBuyingUnitUgx / per);
}

export function purchaseLineCostTotalUgx(line: { qtyBuyingUnits: number; costPerBuyingUnitUgx: number }): number {
  return Math.round(line.qtyBuyingUnits * line.costPerBuyingUnitUgx);
}

/** New average cost per base unit after stock-in (weighted by quantity). */
export function weightedCostAfterStockIn(
  prevStock: number,
  prevCostPerBaseUgx: number,
  incomingBaseUnits: number,
  incomingCostPerBaseUgx: number,
): number {
  const next = prevStock + incomingBaseUnits;
  if (next <= 0) return Math.max(0, incomingCostPerBaseUgx);
  return Math.round((prevStock * prevCostPerBaseUgx + incomingBaseUnits * incomingCostPerBaseUgx) / next);
}
