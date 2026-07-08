import type { Product } from "../types";
import {
  formatUgxDisplay,
  inventoryLineValueAtCostUgx,
  inventoryValueAtCostUgx as inventoryValueAtCostPrecise,
  markupPercentOnCost,
  normalizeUnitCostUgx,
  profitPerUnitUgx,
} from "./costPrecision";
import { getProductCostWarnings } from "./costValidation";
import { isPharmacyMode } from "./pharmacy";
import type { BusinessType } from "../types";
import { isPharmacyPackagingActive, packagingMarginStock } from "./pharmacyPackaging";

export type PharmacyCostWarningKind =
  | "zero_cost"
  | "zero_price"
  | "sell_below_cost"
  | "extreme_margin"
  | "low_unit_cost"
  | "high_margin";

export type PharmacyCostWarning = {
  kind: PharmacyCostWarningKind;
  /** i18n key */
  messageKey: string;
};

const PHARMACY_WARNING_KEYS: Record<string, string> = {
  zero_cost: "pharmacyWarnZeroCost",
  zero_price: "pharmacyWarnZeroPrice",
  sell_below_cost: "pharmacyWarnSellBelowCost",
  extreme_margin: "pharmacyWarnExtremeMargin",
  low_unit_cost: "costPreviewWarningTitle",
  high_margin: "costPreviewWarningTitle",
};

/** Non-blocking cost/price sanity checks for pharmacy products. */
export function pharmacyCostWarnings(product: Product): PharmacyCostWarning[] {
  const cost = normalizeUnitCostUgx(product.costPricePerUnitUgx);
  const sell = Math.max(0, Math.floor(product.sellingPricePerUnitUgx));
  return getProductCostWarnings({ unitCostUgx: cost, sellPriceUgx: sell, pharmacyMode: true }).map((w) => ({
    kind: w.kind as PharmacyCostWarningKind,
    messageKey: w.messageKey ?? PHARMACY_WARNING_KEYS[w.kind] ?? "costPreviewWarningTitle",
  }));
}

export function pharmacyMarginUgx(product: Product): number {
  const cost = normalizeUnitCostUgx(product.costPricePerUnitUgx);
  const sell = Math.max(0, Math.floor(product.sellingPricePerUnitUgx));
  return profitPerUnitUgx(sell, cost) ?? 0;
}

/** Markup on cost — used by pharmacy margin reports (distinct from retail margin-on-sell). */
export function pharmacyMarginPercent(product: Product): number | null {
  const cost = normalizeUnitCostUgx(product.costPricePerUnitUgx);
  const sell = Math.max(0, Math.floor(product.sellingPricePerUnitUgx));
  return markupPercentOnCost(sell, cost);
}

export type MedicineMarginRow = {
  productId: string;
  name: string;
  category: string;
  costPerUnitUgx: number;
  sellingPricePerUnitUgx: number;
  marginUgx: number;
  marginPercent: number | null;
  stockOnHand: number;
  inventoryValueUgx: number;
  stockTablets: number;
  stockStrips: number | null;
  stockBoxes: number | null;
  packagingEnabled: boolean;
};

export type MedicineMarginSort = "highest_margin" | "lowest_margin" | "largest_inventory_value";

export function computeMedicineMarginRows(products: Product[]): MedicineMarginRow[] {
  return products
    .filter((p) => p.stockOnHand > 0 || p.sellingPricePerUnitUgx > 0 || p.costPricePerUnitUgx > 0)
    .map((p) => {
      const cost = normalizeUnitCostUgx(p.costPricePerUnitUgx);
      const sell = Math.max(0, Math.floor(p.sellingPricePerUnitUgx));
      const stock = Math.max(0, Number(p.stockOnHand) || 0);
      const packStock = packagingMarginStock(p);
      return {
        productId: p.id,
        name: p.name,
        category: (p.category ?? "").trim() || "—",
        costPerUnitUgx: formatUgxDisplay(cost),
        sellingPricePerUnitUgx: sell,
        marginUgx: pharmacyMarginUgx(p),
        marginPercent: pharmacyMarginPercent(p),
        stockOnHand: stock,
        inventoryValueUgx: inventoryLineValueAtCostUgx(p),
        stockTablets: packStock?.stockTablets ?? stock,
        stockStrips: packStock?.stockStrips ?? null,
        stockBoxes: packStock?.stockBoxes ?? null,
        packagingEnabled: isPharmacyPackagingActive(p),
      };
    });
}

export function sortMedicineMarginRows(rows: MedicineMarginRow[], sort: MedicineMarginSort): MedicineMarginRow[] {
  const copy = [...rows];
  if (sort === "highest_margin") {
    copy.sort((a, b) => b.marginUgx - a.marginUgx || a.name.localeCompare(b.name));
  } else if (sort === "lowest_margin") {
    copy.sort((a, b) => a.marginUgx - b.marginUgx || a.name.localeCompare(b.name));
  } else {
    copy.sort((a, b) => b.inventoryValueUgx - a.inventoryValueUgx || a.name.localeCompare(b.name));
  }
  return copy;
}

export function pharmacyInventoryValueAtCostUgx(products: Product[]): number {
  return inventoryValueAtCostPrecise(products);
}

export function pharmacyQuickAddRequiresBuyPrice(
  businessType: BusinessType,
  pharmacyModeEnabled?: boolean | null,
): boolean {
  return isPharmacyMode(businessType, pharmacyModeEnabled);
}
