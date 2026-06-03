import type { Product } from "../types";
import { isPharmacyMode } from "./pharmacy";
import type { BusinessType } from "../types";
import { isPharmacyPackagingActive, packagingMarginStock } from "./pharmacyPackaging";

export type PharmacyCostWarningKind =
  | "zero_cost"
  | "zero_price"
  | "sell_below_cost"
  | "extreme_margin";

export type PharmacyCostWarning = {
  kind: PharmacyCostWarningKind;
  /** i18n key */
  messageKey: string;
};

const EXTREME_MARGIN_RATIO = 5;

/** Non-blocking cost/price sanity checks for pharmacy products. */
export function pharmacyCostWarnings(product: Product): PharmacyCostWarning[] {
  const cost = Math.max(0, Math.floor(product.costPricePerUnitUgx));
  const sell = Math.max(0, Math.floor(product.sellingPricePerUnitUgx));
  const out: PharmacyCostWarning[] = [];

  if (cost <= 0) out.push({ kind: "zero_cost", messageKey: "pharmacyWarnZeroCost" });
  if (sell <= 0) out.push({ kind: "zero_price", messageKey: "pharmacyWarnZeroPrice" });
  if (cost > 0 && sell > 0 && sell < cost) {
    out.push({ kind: "sell_below_cost", messageKey: "pharmacyWarnSellBelowCost" });
  }
  if (cost > 0 && sell > cost * EXTREME_MARGIN_RATIO) {
    out.push({ kind: "extreme_margin", messageKey: "pharmacyWarnExtremeMargin" });
  }
  return out;
}

export function pharmacyMarginUgx(product: Product): number {
  const cost = Math.max(0, Math.floor(product.costPricePerUnitUgx));
  const sell = Math.max(0, Math.floor(product.sellingPricePerUnitUgx));
  return sell - cost;
}

export function pharmacyMarginPercent(product: Product): number | null {
  const cost = Math.max(0, Math.floor(product.costPricePerUnitUgx));
  const sell = Math.max(0, Math.floor(product.sellingPricePerUnitUgx));
  if (cost <= 0) return null;
  return Math.round(((sell - cost) / cost) * 100);
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
      const cost = Math.max(0, Math.floor(p.costPricePerUnitUgx));
      const sell = Math.max(0, Math.floor(p.sellingPricePerUnitUgx));
      const stock = Math.max(0, Number(p.stockOnHand) || 0);
      const packStock = packagingMarginStock(p);
      return {
        productId: p.id,
        name: p.name,
        category: (p.category ?? "").trim() || "—",
        costPerUnitUgx: cost,
        sellingPricePerUnitUgx: sell,
        marginUgx: pharmacyMarginUgx(p),
        marginPercent: pharmacyMarginPercent(p),
        stockOnHand: stock,
        inventoryValueUgx: Math.round(stock * cost),
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
  return products.reduce(
    (sum, p) => sum + Math.max(0, p.stockOnHand) * Math.max(0, Math.floor(p.costPricePerUnitUgx)),
    0,
  );
}

export function pharmacyQuickAddRequiresBuyPrice(
  businessType: BusinessType,
  pharmacyModeEnabled?: boolean | null,
): boolean {
  return isPharmacyMode(businessType, pharmacyModeEnabled);
}
