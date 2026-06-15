import type { LineInputMode, Product } from "../types";
import { isPharmacyPackagingActive } from "./pharmacyPackaging";
import { getPosSellPresets, lineTotalFromQuantity, pricePerBaseUnitUgx, quantityFromMoneyUgx } from "./sellingEngine";

export type ScanToCartInput = {
  inputMode: LineInputMode;
  value: number;
};

const QTY_EPS = 1e-4;

function qtyRoughlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < QTY_EPS;
}

/** One money + one qty preset describing the same sell option (paired row). */
export function resolvePairedSinglePreset(product: Product): ScanToCartInput | null {
  const moneyPresets = product.quickPresetsMoneyUgx?.filter((x) => x > 0) ?? [];
  const qtyPresets = product.quickPresetsQty?.filter((x) => x > 0) ?? [];
  if (moneyPresets.length !== 1 || qtyPresets.length !== 1) return null;

  const money = moneyPresets[0]!;
  const qty = qtyPresets[0]!;
  const expectedMoney = lineTotalFromQuantity(product, qty);
  if (expectedMoney !== money) return null;

  const derivedQty = quantityFromMoneyUgx(product, money);
  if (derivedQty <= 0 || !qtyRoughlyEqual(derivedQty, qty)) return null;

  return { inputMode: "money", value: money };
}

/**
 * Barcode fast lane: auto-add without opening the product sheet when price and presets
 * are unambiguous. Does not change cart math — only routing.
 */
export function resolveScanToCartInput(product: Product): ScanToCartInput | null {
  if (isPharmacyPackagingActive(product)) return null;

  const price = pricePerBaseUnitUgx(product);
  if (price <= 0) return null;

  const paired = resolvePairedSinglePreset(product);
  if (paired) return paired;

  const moneyPresets = product.quickPresetsMoneyUgx?.filter((x) => x > 0) ?? [];
  const qtyPresets = product.quickPresetsQty?.filter((x) => x > 0) ?? [];

  if (moneyPresets.length === 1 && qtyPresets.length === 0) {
    return { inputMode: "money", value: moneyPresets[0]! };
  }
  if (qtyPresets.length === 1 && moneyPresets.length === 0) {
    return { inputMode: "quantity", value: qtyPresets[0]! };
  }
  if (moneyPresets.length === 1 && qtyPresets.length === 1) {
    return null;
  }

  const sellPresets = getPosSellPresets(product);
  if (sellPresets.length > 1) return null;

  return { inputMode: "quantity", value: 1 };
}

export function canScanToCartFastAdd(product: Product): boolean {
  return resolveScanToCartInput(product) !== null;
}
