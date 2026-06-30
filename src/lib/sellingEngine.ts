import type { LineInputMode, Product, SaleLine } from "../types";
import {
  getPharmacyPackagingSellPresets,
  isPharmacyPackagingActive,
  lowStockThresholdBaseUnits,
} from "./pharmacyPackaging";
import { formatMedicineFullLabel } from "./pharmacyMedicine";
import { formatQuantityWithFractions } from "./formatQuantityWithFractions";
import {
  applyPackSlotCostsToSaleLine,
  costPerBaseFromBuyingUnitCostPrecise,
  costPerBaseUnitUgxFromProduct,
  resolvePackCostUnitsDepleted,
  weightedCostAfterStockInPrecise,
} from "./costPrecision";
import { resolveSaleLineFinancials } from "./saleFinancialEngine";

const MONEY_ROUND = 4;

export type StockBreakdown = {
  fullPacks: number;
  loosePieces: number;
  totalPieces: number;
  hasPackTracking: boolean;
  packLabel: string | null;
  pieceLabel: string;
};

export type PosSellPreset = {
  mode: LineInputMode;
  value: number;
  label: string;
  priceLabel: string;
};

function capitalizeWord(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Pack name stored on product (before optional supplier suffix). */
export function packLabelFromProduct(product: Product): string | null {
  const raw = (product.buyingUnit ?? "").trim();
  if (!raw) return null;
  return raw.split("·")[0]?.trim() || null;
}

export function stockBreakdown(product: Product): StockBreakdown {
  const total = Math.max(0, Number(product.stockOnHand) || 0);
  const pieceLabel = product.baseUnit || "ea";
  const packLabel = packLabelFromProduct(product);
  const rate = baseUnitsPerBuyingUnit(product);
  const hasPackTracking = Boolean(packLabel && rate > 1);

  if (!hasPackTracking) {
    return {
      fullPacks: 0,
      loosePieces: total,
      totalPieces: total,
      hasPackTracking: false,
      packLabel: null,
      pieceLabel,
    };
  }

  const fullPacks = Math.floor(total / rate);
  const loosePieces = Math.round((total - fullPacks * rate) * 10 ** MONEY_ROUND) / 10 ** MONEY_ROUND;

  return {
    fullPacks,
    loosePieces,
    totalPieces: total,
    hasPackTracking: true,
    packLabel,
    pieceLabel,
  };
}

export function formatStockLabel(product: Product): string {
  const b = stockBreakdown(product);
  if (!b.hasPackTracking || !b.packLabel) {
    const n = b.totalPieces;
    const shown = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
    return `${shown} ${b.pieceLabel}`;
  }

  const pack = capitalizeWord(b.packLabel);
  const piece = b.pieceLabel;
  const packPlural = b.fullPacks === 1 ? pack : `${pack}s`;

  if (b.loosePieces <= 0) {
    const totalShown = Number.isInteger(b.totalPieces)
      ? String(b.totalPieces)
      : b.totalPieces.toFixed(2).replace(/\.?0+$/, "");
    return `${b.fullPacks} ${packPlural} · ${totalShown} ${capitalizeWord(piece)}`;
  }

  if (b.fullPacks <= 0) {
    const looseShown = Number.isInteger(b.loosePieces)
      ? String(b.loosePieces)
      : b.loosePieces.toFixed(2).replace(/\.?0+$/, "");
    return `${looseShown} ${capitalizeWord(piece)}`;
  }

  const looseShown = Number.isInteger(b.loosePieces)
    ? String(b.loosePieces)
    : b.loosePieces.toFixed(2).replace(/\.?0+$/, "");
  return `${b.fullPacks} Full ${packPlural} + ${looseShown} ${capitalizeWord(piece)}`;
}

/** Friendly sell buttons: one piece + full pack when applicable. */
export function getPosSellPresets(product: Product): PosSellPreset[] {
  if (isPharmacyPackagingActive(product)) {
    const pharmacyPresets = getPharmacyPackagingSellPresets(product);
    if (pharmacyPresets.length > 0) return pharmacyPresets;
  }

  const price = pricePerBaseUnitUgx(product);
  if (price <= 0) return [];

  const unit = product.baseUnit || "ea";
  const rate = baseUnitsPerBuyingUnit(product);
  const packName = packLabelFromProduct(product);
  const presets: PosSellPreset[] = [
    {
      mode: "quantity",
      value: 1,
      label: `1 ${unit}`,
      priceLabel: `${price.toLocaleString()} UGX`,
    },
  ];

  if (rate > 1 && packName) {
    const packPrice = Math.round(price * rate);
    presets.push({
      mode: "quantity",
      value: rate,
      label: `1 ${packName}`,
      priceLabel: `${packPrice.toLocaleString()} UGX`,
    });
  }

  const moneyPresets = product.quickPresetsMoneyUgx?.filter((x) => x > 0) ?? [];
  const qtyPresets = product.quickPresetsQty?.filter((x) => x > 0) ?? [];
  for (let i = 0; i < moneyPresets.length; i++) {
    const money = moneyPresets[i]!;
    const qty = qtyPresets[i];
    if (qty != null && qty > 0 && qty !== 1 && qty !== rate) {
      presets.push({
        mode: "quantity",
        value: qty,
        label: formatQuantityWithFractions(qty, unit),
        priceLabel: `${Math.round(qty * price).toLocaleString()} UGX`,
      });
    }
    if (money !== price && money !== Math.round(price * rate)) {
      const moneyQty =
        qty != null && qty > 0 ? qty : Math.round((money / price) * 10 ** MONEY_ROUND) / 10 ** MONEY_ROUND;
      presets.push({
        mode: "money",
        value: money,
        label:
          qty != null && qty > 0
            ? formatQuantityWithFractions(qty, unit)
            : formatQuantityWithFractions(moneyQty, unit),
        priceLabel: `${money.toLocaleString()} UGX`,
      });
    }
  }

  return presets;
}

/** UGX price per base unit used at the till (falls back to legacy mental model). */
export function pricePerBaseUnitUgx(product: Product): number {
  const p = product.sellingPricePerUnitUgx;
  return p > 0 ? p : 0;
}

export function costPerBaseUnitUgx(product: Product): number {
  return costPerBaseUnitUgxFromProduct(product);
}

/**
 * Customer pays `moneyUgx` only — derive quantity from shelf price.
 * Example: 1000 UGX at 10,000 UGX/litre → 0.1 litre.
 */
export function quantityFromMoneyUgx(product: Product, moneyUgx: number): number {
  const moneyPresets = product.quickPresetsMoneyUgx ?? [];
  const qtyPresets = product.quickPresetsQty ?? [];
  for (let i = 0; i < moneyPresets.length; i++) {
    if (moneyPresets[i] === moneyUgx && qtyPresets[i] != null && qtyPresets[i]! > 0) {
      return qtyPresets[i]!;
    }
  }

  const rate = baseUnitsPerBuyingUnit(product);
  const packName = packLabelFromProduct(product);
  const price = pricePerBaseUnitUgx(product);
  if (price <= 0 || moneyUgx <= 0) return 0;

  if (rate > 1 && packName) {
    const fullPackPrice = Math.round(price * rate);
    if (moneyUgx === fullPackPrice) return rate;
  }

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
  opts?: { packSlotStart?: number },
): { line: SaleLine | null; error?: string } {
  const price = pricePerBaseUnitUgx(product);
  const packSlotStart = opts?.packSlotStart ?? resolvePackCostUnitsDepleted(product);
  if (price <= 0) {
    return { line: null, error: "noPrice" };
  }

  if (inputMode === "money") {
    const money = Math.floor(rawValue);
    if (money <= 0) return { line: null, error: "invalidMoney" };
    const qty = quantityFromMoneyUgx(product, money);
    if (qty <= 0) return { line: null, error: "qtyZero" };
    const slotCosts = applyPackSlotCostsToSaleLine(product, { quantity: qty, lineTotalUgx: money }, packSlotStart);
    const now = new Date().toISOString();
    return {
      line: {
        id: crypto.randomUUID(),
        updatedAt: now,
        productId: product.id,
        name: formatMedicineFullLabel(product),
        inputMode: "money",
        quantity: qty,
        unitPriceUgx: price,
        unitCostUgx: slotCosts.unitCostUgx,
        lineTotalUgx: money,
        estimatedProfitUgx: slotCosts.estimatedProfitUgx,
        moneyAmountUgx: money,
      },
    };
  }

  const qty = Math.round(rawValue * 10 ** MONEY_ROUND) / 10 ** MONEY_ROUND;
  if (qty <= 0) return { line: null, error: "invalidQty" };
  const lineTotalUgx = lineTotalFromQuantity(product, qty);
  const slotCosts = applyPackSlotCostsToSaleLine(product, { quantity: qty, lineTotalUgx }, packSlotStart);
  const now = new Date().toISOString();
  return {
    line: {
      id: crypto.randomUUID(),
      updatedAt: now,
      productId: product.id,
      name: formatMedicineFullLabel(product),
      inputMode: "quantity",
      quantity: qty,
      unitPriceUgx: price,
      unitCostUgx: slotCosts.unitCostUgx,
      lineTotalUgx,
      estimatedProfitUgx: slotCosts.estimatedProfitUgx,
      moneyAmountUgx: null,
    },
  };
}

/** Simple line profit: sale amount minus pack-aware COGS for the quantity sold. */
export function estimatedProfitForLine(_product: Product, line: SaleLine): number {
  return resolveSaleLineFinancials(line).grossProfitUgx;
}

export function lowStockThreshold(product: Product): number {
  if (isPharmacyPackagingActive(product)) {
    return lowStockThresholdBaseUnits(product);
  }
  const m = product.minimumStockAlert;
  return m > 0 ? m : 0;
}

export function isLowStock(product: Product): boolean {
  const t = lowStockThreshold(product);
  return t > 0 && product.stockOnHand <= t;
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
  return costPerBaseFromBuyingUnitCostPrecise(baseUnitsPerBuyingUnit(product), costPerBuyingUnitUgx);
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
  return weightedCostAfterStockInPrecise(prevStock, prevCostPerBaseUgx, incomingBaseUnits, incomingCostPerBaseUgx);
}
