import type { LineInputMode, Product, SaleLine } from "../types";

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
      label: `Full ${packName}`,
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
        label: `${qty} ${unit}`,
        priceLabel: `${Math.round(qty * price).toLocaleString()} UGX`,
      });
    }
    if (money !== price && money !== Math.round(price * rate)) {
      presets.push({
        mode: "money",
        value: money,
        label: `${money.toLocaleString()} UGX`,
        priceLabel: qty != null && qty > 0 ? `${qty} ${unit}` : "",
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
  const c = product.costPricePerUnitUgx;
  return c >= 0 ? c : 0;
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
): { line: SaleLine | null; error?: string } {
  const price = pricePerBaseUnitUgx(product);
  const cost = costPerBaseUnitUgx(product);
  if (price <= 0) {
    return { line: null, error: "noPrice" };
  }

  if (inputMode === "money") {
    const money = Math.floor(rawValue);
    if (money <= 0) return { line: null, error: "invalidMoney" };
    const qty = quantityFromMoneyUgx(product, money);
    if (qty <= 0) return { line: null, error: "qtyZero" };
    const estimatedProfitUgx = Math.round(money - qty * cost);
    return {
      line: {
        productId: product.id,
        name: product.name,
        inputMode: "money",
        quantity: qty,
        unitPriceUgx: price,
        unitCostUgx: cost,
        lineTotalUgx: money,
        estimatedProfitUgx,
        moneyAmountUgx: money,
      },
    };
  }

  const qty = Math.round(rawValue * 10 ** MONEY_ROUND) / 10 ** MONEY_ROUND;
  if (qty <= 0) return { line: null, error: "invalidQty" };
  const lineTotalUgx = lineTotalFromQuantity(product, qty);
  return {
    line: {
      productId: product.id,
      name: product.name,
      inputMode: "quantity",
      quantity: qty,
      unitPriceUgx: price,
      unitCostUgx: cost,
      lineTotalUgx,
      estimatedProfitUgx: Math.round(lineTotalUgx - qty * cost),
      moneyAmountUgx: null,
    },
  };
}

/** Simple line profit: sale amount minus the buying-cost snapshot for the quantity sold. */
export function estimatedProfitForLine(product: Product, line: SaleLine): number {
  if (Number.isFinite(line.estimatedProfitUgx)) return Math.round(line.estimatedProfitUgx);
  const cost = Number.isFinite(line.unitCostUgx) ? line.unitCostUgx : costPerBaseUnitUgx(product);
  return Math.round(line.lineTotalUgx - line.quantity * cost);
}

export function lowStockThreshold(product: Product): number {
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
