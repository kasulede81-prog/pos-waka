import type { Product, SaleLine } from "../types";
import { formatPharmacySaleQtyLabel, isPharmacyPackagingActive } from "./pharmacyPackaging";
import { formatQuantityWithFractions, roundSaleQuantity } from "./formatQuantityWithFractions";
import { packLabelFromProduct, baseUnitsPerBuyingUnit } from "./sellingEngine";

export type ReceiptLineQuantityDisplay = {
  quantityLabel: string;
  showCalculation: boolean;
};

/**
 * Quantity sold for display — for custom-amount (money) lines, derive from
 * total ÷ unit price so receipts never show the UGX amount as the quantity.
 */
export function resolveSaleLineQuantity(line: SaleLine): number {
  const stored = roundSaleQuantity(Math.max(0, Number(line.quantity) || 0));
  if (line.inputMode !== "money") return stored;

  const unitPrice = Math.max(0, Math.floor(Number(line.unitPriceUgx) || 0));
  if (unitPrice <= 0) return stored;

  const amount = Math.max(0, Math.floor(Number(line.moneyAmountUgx ?? line.lineTotalUgx) || 0));
  if (amount <= 0) return stored;

  const derived = roundSaleQuantity(amount / unitPrice);
  if (derived <= 0) return stored;

  // Stored quantity equals the money amount (legacy / bad data) — use derived.
  if (Math.abs(stored - amount) < 0.01 && amount >= unitPrice) return derived;

  // Stored quantity does not reconcile with amount ÷ price — prefer derived for display.
  const expectedTotal = roundSaleQuantity(stored * unitPrice);
  if (Math.abs(expectedTotal - amount) > unitPrice * 0.02) return derived;

  return stored > 0 ? stored : derived;
}

/** Formatted quantity for any sale line (cart, history, returns, receipts). */
export function formatSaleLineQuantity(
  line: SaleLine,
  product: Product | undefined,
  style: "short" | "receipt" = "short",
): string {
  if (product && isPharmacyPackagingActive(product)) {
    return formatPharmacySaleQtyLabel(product, line, style);
  }

  const qty = resolveSaleLineQuantity(line);
  const baseUnit = line.baseUnit?.trim() || product?.baseUnit?.trim() || "item";

  // Customer receipts always show sell units (1 kg, 2½ kg, 3 packets) — never fractional packs.
  if (style === "receipt") {
    return formatQuantityWithFractions(qty, baseUnit);
  }

  const rate = product ? baseUnitsPerBuyingUnit(product) : 0;
  const pack = product ? packLabelFromProduct(product) : null;

  if (rate > 1 && pack && qty >= rate) {
    const fullPacks = Math.floor(qty / rate);
    const remainder = roundSaleQuantity(qty - fullPacks * rate);
    if (remainder <= 0) {
      return `${fullPacks} ${fullPacks === 1 ? pack : `${pack}s`}`;
    }
    const packPart = fullPacks > 0 ? `${fullPacks} ${fullPacks === 1 ? pack : `${pack}s`} + ` : "";
    return `${packPart}${formatQuantityWithFractions(remainder, baseUnit)}`;
  }

  return formatQuantityWithFractions(qty, baseUnit);
}

/** Receipt calculation row: `3¼ kg × UGX 4,000 = UGX 13,000` */
export function formatReceiptLineCalculation(
  quantityLabel: string,
  unitPriceUgx: number,
  lineTotalUgx: number,
): string {
  return `${quantityLabel} × UGX ${unitPriceUgx.toLocaleString()} = UGX ${lineTotalUgx.toLocaleString()}`;
}

export function buildReceiptLineQuantityDisplay(
  line: SaleLine,
  product?: Product,
): ReceiptLineQuantityDisplay {
  if (product && isPharmacyPackagingActive(product)) {
    const qtyLabel = formatPharmacySaleQtyLabel(product, line, "receipt");
    return { quantityLabel: qtyLabel, showCalculation: line.unitPriceUgx > 0 };
  }

  const quantityLabel = formatSaleLineQuantity(line, product, "receipt");
  const showCalculation = line.unitPriceUgx > 0;

  return { quantityLabel, showCalculation };
}

export { formatQuantityWithFractions, formatFriendlyQuantity } from "./formatQuantityWithFractions";
