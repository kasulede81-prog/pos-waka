import type {
  PharmacyBatchRecord,
  PharmacyLowStockUnit,
  PharmacyPackaging,
  PharmacyPackagingLevel1,
  PharmacyPackagingLevel2,
  PharmacySaleUnitType,
  Product,
  SaleLine,
} from "../types";
import { formatMedicineFullLabel } from "./pharmacyMedicine";
import { normalizeBatchRecord } from "./pharmacyBatches";
import type { PosSellPreset } from "./sellingEngine";
import { costPerBaseUnitUgx, pricePerBaseUnitUgx } from "./sellingEngine";
import { lineCostForProductQuantity, lineProfitUgx, unitCostFromInvoiceTotal } from "./costPrecision";

export type { PharmacyBatchRecord, PharmacyPackaging, PharmacyPackagingLevel1, PharmacyPackagingLevel2 };

/** Base unit kinds (tablet, capsule, …). */
export const PHARMACY_BASE_UNITS = [
  "tablet",
  "capsule",
  "bottle",
  "vial",
  "sachet",
  "tube",
  "other",
] as const;

export type PharmacyBaseUnit = (typeof PHARMACY_BASE_UNITS)[number];

export const PHARMACY_LEVEL1_UNITS = ["strip", "blister", "pack", "bundle", "carton", "other"] as const;
export type PharmacyLevel1Unit = (typeof PHARMACY_LEVEL1_UNITS)[number];

export const PHARMACY_LEVEL2_UNITS = ["box", "carton", "case", "other"] as const;
export type PharmacyLevel2Unit = (typeof PHARMACY_LEVEL2_UNITS)[number];

export function isPharmacyPackagingActive(product: Product): boolean {
  return Boolean(product.pharmacyPackaging?.enabled);
}

export function parsePositiveInt(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : Math.floor(Number(String(raw ?? "").replace(/\D/g, "")) || 0);
  return n > 0 ? n : 0;
}

/** Total base units from opening stock (simple) or received outer packages (structured). */
export function calcTotalBaseUnits(input: {
  packaging: PharmacyPackaging | null | undefined;
  openingStockBase?: number;
  receivedLevel2Qty?: number;
  receivedLevel1Qty?: number;
}): number {
  const pkg = input.packaging;
  if (!pkg?.enabled) {
    return Math.max(0, Math.floor(Number(input.openingStockBase) || 0));
  }

  const l1 = pkg.level1;
  const perL1 = l1 && l1.containsBaseUnits > 0 ? Math.floor(l1.containsBaseUnits) : 0;
  const l2 = pkg.level2;
  const l2Count = l2 && l2.containsLevel1Units > 0 ? Math.floor(l2.containsLevel1Units) : 0;

  if (l2 && perL1 > 0 && l2Count > 0) {
    const boxes = parsePositiveInt(input.receivedLevel2Qty);
    return boxes * l2Count * perL1;
  }
  if (l1 && perL1 > 0) {
    const strips = parsePositiveInt(input.receivedLevel1Qty ?? input.receivedLevel2Qty);
    if (strips > 0) return strips * perL1;
  }
  return Math.max(0, Math.floor(Number(input.openingStockBase) || 0));
}

export function calcCostPerBaseUnitUgx(totalInvoiceUgx: number, totalBaseUnits: number): number {
  return unitCostFromInvoiceTotal(totalInvoiceUgx, totalBaseUnits);
}

export function baseUnitsPerStrip(pkg: PharmacyPackaging): number {
  const n = pkg.level1?.containsBaseUnits ?? 0;
  return n > 0 ? Math.floor(n) : 0;
}

export function baseUnitsPerBox(pkg: PharmacyPackaging): number {
  const perStrip = baseUnitsPerStrip(pkg);
  const stripsPerBox = pkg.level2?.containsLevel1Units ?? 0;
  if (perStrip <= 0 || stripsPerBox <= 0) return 0;
  return perStrip * Math.floor(stripsPerBox);
}

export function deriveStripPriceUgx(tabletPriceUgx: number, baseUnitsPerStripCount: number): number {
  const p = Math.max(0, Math.floor(tabletPriceUgx));
  const n = Math.max(1, Math.floor(baseUnitsPerStripCount));
  return Math.round(p * n);
}

export function deriveBoxPriceUgx(tabletPriceUgx: number, baseUnitsPerBoxCount: number): number {
  const p = Math.max(0, Math.floor(tabletPriceUgx));
  const n = Math.max(1, Math.floor(baseUnitsPerBoxCount));
  return Math.round(p * n);
}

export function stripPriceForProduct(product: Product): number | null {
  const pkg = product.pharmacyPackaging;
  if (!pkg?.enabled || !pkg.sell.strip) return null;
  if (pkg.priceStripUgx != null && pkg.priceStripUgx > 0) return Math.floor(pkg.priceStripUgx);
  const perStrip = baseUnitsPerStrip(pkg);
  if (perStrip <= 0) return null;
  return deriveStripPriceUgx(pricePerBaseUnitUgx(product), perStrip);
}

export function boxPriceForProduct(product: Product): number | null {
  const pkg = product.pharmacyPackaging;
  if (!pkg?.enabled || !pkg.sell.box) return null;
  if (pkg.priceBoxUgx != null && pkg.priceBoxUgx > 0) return Math.floor(pkg.priceBoxUgx);
  const perBox = baseUnitsPerBox(pkg);
  if (perBox <= 0) return null;
  return deriveBoxPriceUgx(pricePerBaseUnitUgx(product), perBox);
}

/** Profit for a sale line always uses base-unit cost (quantity is in base units). */
export function pharmacyLineProfitUgx(lineTotalUgx: number, quantityBase: number, product: Product): number {
  const revenue = Math.max(0, Math.floor(lineTotalUgx));
  const cost = lineCostForProductQuantity(product, quantityBase);
  return lineProfitUgx(revenue, cost);
}

export type PackagingStockPreviewLine = { count: number; label: string };

/** Human-readable breakdown for wizard / restock preview. */
export function packagingStockPreviewLines(
  pkg: PharmacyPackaging,
  receivedLevel2Qty: number,
): PackagingStockPreviewLine[] {
  const lines: PackagingStockPreviewLine[] = [];
  const totalBase = calcTotalBaseUnits({
    packaging: pkg,
    receivedLevel2Qty,
    receivedLevel1Qty: receivedLevel2Qty,
  });

  if (pkg.level2 && receivedLevel2Qty > 0) {
    lines.push({ count: receivedLevel2Qty, label: pkg.level2.unit });
    const strips = receivedLevel2Qty * (pkg.level2.containsLevel1Units || 0);
    if (pkg.level1 && strips > 0) {
      lines.push({ count: strips, label: pkg.level1.unit });
    }
  } else if (pkg.level1 && receivedLevel2Qty > 0) {
    lines.push({ count: receivedLevel2Qty, label: pkg.level1.unit });
  }

  lines.push({ count: totalBase, label: pkg.baseUnit });
  return lines;
}

/** Map product packaging to retail buyingUnit + conversionRate for restock-by-box UX. */
export function buyingUnitFromPackaging(pkg: PharmacyPackaging): {
  buyingUnit: string | null;
  conversionRate: number | null;
} {
  if (!pkg.enabled) return { buyingUnit: null, conversionRate: null };
  const perBox = baseUnitsPerBox(pkg);
  if (pkg.level2 && perBox > 0) {
    return { buyingUnit: String(pkg.level2.unit), conversionRate: perBox };
  }
  const perStrip = baseUnitsPerStrip(pkg);
  if (pkg.level1 && perStrip > 0) {
    return { buyingUnit: String(pkg.level1.unit), conversionRate: perStrip };
  }
  return { buyingUnit: null, conversionRate: null };
}

export function getPharmacyPackagingSellPresets(product: Product): PosSellPreset[] {
  const pkg = product.pharmacyPackaging;
  if (!pkg?.enabled) return [];

  const tabletPrice = pricePerBaseUnitUgx(product);
  if (tabletPrice <= 0) return [];

  const presets: PosSellPreset[] = [];
  const base = pkg.baseUnit || "tablet";

  if (pkg.sell.tablet !== false) {
    presets.push({
      mode: "quantity",
      value: 1,
      label: `1 ${base}`,
      priceLabel: `${tabletPrice.toLocaleString()} UGX`,
    });
  }

  const perStrip = baseUnitsPerStrip(pkg);
  const stripPrice = stripPriceForProduct(product);
  if (pkg.sell.strip && perStrip > 0 && stripPrice != null && stripPrice > 0) {
    presets.push({
      mode: "quantity",
      value: perStrip,
      label: `1 ${pkg.level1?.unit ?? "strip"}`,
      priceLabel: `${stripPrice.toLocaleString()} UGX`,
    });
  }

  const perBox = baseUnitsPerBox(pkg);
  const boxPrice = boxPriceForProduct(product);
  if (pkg.sell.box && perBox > 0 && boxPrice != null && boxPrice > 0) {
    presets.push({
      mode: "quantity",
      value: perBox,
      label: `1 ${pkg.level2?.unit ?? "box"}`,
      priceLabel: `${boxPrice.toLocaleString()} UGX`,
    });
  }

  return presets;
}

export function normalizePharmacyPackaging(raw: unknown): PharmacyPackaging | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.enabled !== true) return null;
  const sellRaw = (r.sell ?? {}) as Record<string, unknown>;
  return {
    enabled: true,
    baseUnit: String(r.baseUnit ?? "tablet"),
    level1: parseLevel1(r.level1),
    level2: parseLevel2(r.level2),
    sell: {
      tablet: sellRaw.tablet !== false,
      strip: Boolean(sellRaw.strip),
      box: Boolean(sellRaw.box),
    },
    priceStripUgx: r.priceStripUgx != null ? Math.floor(Number(r.priceStripUgx)) : null,
    priceBoxUgx: r.priceBoxUgx != null ? Math.floor(Number(r.priceBoxUgx)) : null,
    lowStockAlertUnit: parseLowStockUnit(r.lowStockAlertUnit),
    batches: Array.isArray(r.batches)
      ? (r.batches.map(normalizeBatchRecord).filter(Boolean) as PharmacyBatchRecord[])
      : [],
  };
}

function parseLowStockUnit(raw: unknown): PharmacyLowStockUnit | null {
  if (raw === "strip" || raw === "box" || raw === "tablet") return raw;
  return null;
}

function parseLevel1(raw: unknown): import("../types").PharmacyPackagingLevel1 | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const contains = Math.floor(Number(r.containsBaseUnits ?? r.contains ?? 0));
  if (contains <= 0) return null;
  return { unit: String(r.unit ?? "strip"), containsBaseUnits: contains };
}

function parseLevel2(raw: unknown): PharmacyPackagingLevel2 | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const contains = Math.floor(Number(r.containsLevel1Units ?? r.contains ?? 0));
  if (contains <= 0) return null;
  return { unit: String(r.unit ?? "box"), containsLevel1Units: contains };
}

function capUnit(s: string): string {
  const u = s.trim() || "unit";
  return u.length <= 3 ? u : u.charAt(0).toUpperCase() + u.slice(1);
}

function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  return n.toFixed(1).replace(/\.0$/, "");
}

export type PackagingStockBreakdown = {
  baseTotal: number;
  baseUnitLabel: string;
  stripCount: number | null;
  stripUnit: string | null;
  boxCount: number | null;
  boxUnit: string | null;
};

/** Live breakdown from base stock + packaging metadata (nothing stored). */
export function stockPackagingBreakdown(product: Product): PackagingStockBreakdown | null {
  const pkg = product.pharmacyPackaging;
  if (!pkg?.enabled) return null;

  const baseTotal = Math.max(0, Number(product.stockOnHand) || 0);
  const perStrip = baseUnitsPerStrip(pkg);
  const perBox = baseUnitsPerBox(pkg);

  let stripCount: number | null = null;
  let boxCount: number | null = null;

  if (perBox > 0) {
    boxCount = baseTotal / perBox;
    if (perStrip > 0) stripCount = baseTotal / perStrip;
  } else if (perStrip > 0) {
    stripCount = baseTotal / perStrip;
  }

  return {
    baseTotal,
    baseUnitLabel: pkg.baseUnit || product.baseUnit || "tablet",
    stripCount,
    stripUnit: pkg.level1?.unit ?? null,
    boxCount,
    boxUnit: pkg.level2?.unit ?? null,
  };
}

export function formatPharmacyStockPrimary(product: Product): string {
  const b = stockPackagingBreakdown(product);
  if (!b) return "";
  const label = capUnit(b.baseUnitLabel);
  return `${formatCount(b.baseTotal)} ${label}${b.baseTotal === 1 ? "" : "s"}`;
}

export function formatPharmacyStockEquivalent(product: Product): string | null {
  const b = stockPackagingBreakdown(product);
  if (!b) return null;
  const parts: string[] = [];
  if (b.stripCount != null && b.stripUnit) {
    parts.push(`${formatCount(b.stripCount)} ${capUnit(b.stripUnit)}${b.stripCount === 1 ? "" : "s"}`);
  }
  if (b.boxCount != null && b.boxUnit) {
    parts.push(`${formatCount(b.boxCount)} ${capUnit(b.boxUnit)}${b.boxCount === 1 ? "" : "s"}`);
  }
  return parts.length ? parts.join("\n") : null;
}

/** Minimum stock threshold converted to base units for comparisons. */
export function lowStockThresholdBaseUnits(product: Product): number {
  const alert = Math.max(0, Math.floor(product.minimumStockAlert));
  if (alert <= 0) return 0;
  const pkg = product.pharmacyPackaging;
  if (!pkg?.enabled) return alert;

  const unit: PharmacyLowStockUnit = pkg.lowStockAlertUnit ?? "tablet";
  if (unit === "strip") {
    const per = baseUnitsPerStrip(pkg);
    return per > 0 ? alert * per : alert;
  }
  if (unit === "box") {
    const per = baseUnitsPerBox(pkg);
    return per > 0 ? alert * per : alert;
  }
  return alert;
}

/** Owner-friendly remaining stock when below threshold (e.g. 1.5 Boxes). */
export function formatPharmacyLowStockRemaining(product: Product): string | null {
  const pkg = product.pharmacyPackaging;
  if (!pkg?.enabled) return null;
  const stock = Math.max(0, Number(product.stockOnHand) || 0);
  const unit: PharmacyLowStockUnit = pkg.lowStockAlertUnit ?? "tablet";
  const baseLabel = capUnit(pkg.baseUnit || product.baseUnit);

  if (unit === "box") {
    const per = baseUnitsPerBox(pkg);
    if (per <= 0) return `${formatCount(stock)} ${baseLabel}`;
    const boxes = stock / per;
    const boxLabel = capUnit(pkg.level2?.unit ?? "box");
    return `${formatCount(boxes)} ${boxLabel}${boxes === 1 ? "" : "es"} (${formatCount(stock)} ${baseLabel})`;
  }
  if (unit === "strip") {
    const per = baseUnitsPerStrip(pkg);
    if (per <= 0) return `${formatCount(stock)} ${baseLabel}`;
    const strips = stock / per;
    return `${formatCount(strips)} ${capUnit(pkg.level1?.unit ?? "strip")}${strips === 1 ? "" : "s"} (${formatCount(stock)} ${baseLabel})`;
  }
  return `${formatCount(stock)} ${baseLabel}`;
}

export function baseUnitsForSaleUnit(pkg: PharmacyPackaging, unit: PharmacySaleUnitType): number {
  if (unit === "box") return baseUnitsPerBox(pkg);
  if (unit === "strip") return baseUnitsPerStrip(pkg);
  return 1;
}

export function priceUgxForSaleUnit(product: Product, unit: PharmacySaleUnitType): number | null {
  if (unit === "strip") return stripPriceForProduct(product);
  if (unit === "box") return boxPriceForProduct(product);
  const p = pricePerBaseUnitUgx(product);
  return p > 0 ? p : null;
}

export function detectPharmacySaleUnit(product: Product, baseQuantity: number): PharmacySaleUnitType {
  const pkg = product.pharmacyPackaging;
  if (!pkg?.enabled) return "tablet";
  const perBox = baseUnitsPerBox(pkg);
  const perStrip = baseUnitsPerStrip(pkg);
  if (perBox > 0 && Math.abs(baseQuantity - perBox) < 0.0001) return "box";
  if (perStrip > 0 && Math.abs(baseQuantity - perStrip) < 0.0001) return "strip";
  return "tablet";
}

export function buildPharmacySaleLine(
  product: Product,
  saleUnit: PharmacySaleUnitType,
  qtyInSaleUnit: number,
): { line: SaleLine | null; error?: string } {
  const pkg = product.pharmacyPackaging;
  if (!pkg?.enabled) return { line: null, error: "noPackaging" };

  const per = baseUnitsForSaleUnit(pkg, saleUnit);
  const qtyUnits = Math.round(qtyInSaleUnit * 10 ** 4) / 10 ** 4;
  if (per <= 0 || qtyUnits <= 0) return { line: null, error: "invalidQty" };

  const unitPrice = priceUgxForSaleUnit(product, saleUnit);
  if (unitPrice == null || unitPrice <= 0) return { line: null, error: "noPrice" };

  const baseQty = Math.round(qtyUnits * per * 10 ** 4) / 10 ** 4;
  const lineTotalUgx = Math.round(unitPrice * qtyUnits);
  const cost = costPerBaseUnitUgx(product);
  const baseUnitPrice = pricePerBaseUnitUgx(product);
  const now = new Date().toISOString();

  return {
    line: {
      id: crypto.randomUUID(),
      updatedAt: now,
      productId: product.id,
      name: formatMedicineFullLabel(product),
      inputMode: "quantity",
      quantity: baseQty,
      unitPriceUgx: baseUnitPrice,
      unitCostUgx: cost,
      lineTotalUgx: lineTotalUgx,
      estimatedProfitUgx: pharmacyLineProfitUgx(lineTotalUgx, baseQty, product),
      moneyAmountUgx: null,
      saleUnitType: saleUnit,
      saleUnitQty: qtyUnits,
    },
  };
}

export function formatPharmacySaleQtyLabel(
  product: Product,
  line: Pick<SaleLine, "quantity" | "saleUnitType" | "saleUnitQty">,
  style: "short" | "receipt" = "short",
): string {
  const pkg = product.pharmacyPackaging;
  if (line.saleUnitType && line.saleUnitQty != null && line.saleUnitQty > 0 && pkg?.enabled) {
    const n = formatCount(line.saleUnitQty);
    let unitName = pkg.baseUnit;
    if (line.saleUnitType === "strip") unitName = pkg.level1?.unit ?? "strip";
    if (line.saleUnitType === "box") unitName = pkg.level2?.unit ?? "box";
    const shown = style === "receipt" ? capUnit(unitName) : unitName;
    return `${n} ${shown}${line.saleUnitQty === 1 ? "" : "s"}`;
  }
  const base = pkg?.baseUnit || product.baseUnit || "item";
  const shown = style === "receipt" ? capUnit(base) : base;
  const qty = line.quantity;
  const n = formatCount(qty);
  return `${n} ${shown}${qty === 1 ? "" : "s"}`;
}

export type PharmacyRestockUnit = PharmacySaleUnitType;

export function pharmacyRestockBaseUnits(
  product: Product,
  unit: PharmacyRestockUnit,
  qty: number,
): number {
  const pkg = product.pharmacyPackaging;
  if (!pkg?.enabled) return Math.max(0, Math.floor(qty));
  return calcTotalBaseUnits({
    packaging: pkg,
    receivedLevel2Qty: unit === "box" ? qty : 0,
    receivedLevel1Qty: unit === "strip" ? qty : unit === "tablet" ? qty : 0,
    openingStockBase: unit === "tablet" ? qty : 0,
  });
}

export function pharmacyRestockPreview(
  product: Product,
  unit: PharmacyRestockUnit,
  qty: number,
  invoiceTotalUgx: number,
): {
  lines: PackagingStockPreviewLine[];
  baseUnitsAdded: number;
  costPerBaseUnitUgx: number;
} {
  const pkg = product.pharmacyPackaging;
  const baseUnitsAdded = pharmacyRestockBaseUnits(product, unit, qty);
  const invoice = Math.max(0, Math.floor(invoiceTotalUgx));
  const costPerBaseUnitUgx = calcCostPerBaseUnitUgx(invoice, baseUnitsAdded);

  if (!pkg?.enabled) {
    return {
      lines: [{ count: baseUnitsAdded, label: product.baseUnit }],
      baseUnitsAdded,
      costPerBaseUnitUgx,
    };
  }

  const lines: PackagingStockPreviewLine[] = [];
  if (unit === "box" && pkg.level2) {
    lines.push({ count: qty, label: pkg.level2.unit });
    const strips = qty * (pkg.level2.containsLevel1Units || 0);
    if (pkg.level1 && strips > 0) lines.push({ count: strips, label: pkg.level1.unit });
  } else if (unit === "strip" && pkg.level1) {
    lines.push({ count: qty, label: pkg.level1.unit });
  } else if (unit === "tablet") {
    lines.push({ count: qty, label: pkg.baseUnit });
  }
  lines.push({ count: baseUnitsAdded, label: pkg.baseUnit });
  return { lines, baseUnitsAdded, costPerBaseUnitUgx };
}

export type PackagingMarginStock = {
  stockTablets: number;
  stockStrips: number | null;
  stockBoxes: number | null;
};

export function packagingMarginStock(product: Product): PackagingMarginStock | null {
  const b = stockPackagingBreakdown(product);
  if (!b) return null;
  return {
    stockTablets: b.baseTotal,
    stockStrips: b.stripCount,
    stockBoxes: b.boxCount,
  };
}
