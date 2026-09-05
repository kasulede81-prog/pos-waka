import type { Language, Product } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";

export const REPORTS_STOCK_NOW_PREVIEW_LIMIT = 12;
export const REPORTS_STOCK_NOW_HREF = "/stock";

export type ReportsStockNowPreview<T> = {
  rows: T[];
  shown: number;
  total: number;
  showCount: boolean;
  showViewStock: boolean;
};

/** First-N catalog preview. Does not rank, filter, or date-scope products. */
export function reportsStockNowPreview<T>(products: readonly T[]): ReportsStockNowPreview<T> {
  const total = products.length;
  const rows = products.slice(0, REPORTS_STOCK_NOW_PREVIEW_LIMIT);
  const hasProducts = total > 0;
  return {
    rows,
    shown: rows.length,
    total,
    showCount: hasProducts,
    showViewStock: hasProducts,
  };
}

export function reportsStockNowHeading(lang: Language, shown: number, total: number): string {
  if (total <= 0) return t(lang, "stockRemainingHint");
  return `${t(lang, "stockRemainingHint")} · ${tTemplate(lang, "reportsStockNowCount", { shown, total })}`;
}

/** Quantity-only fields for the preview row — never cost/value. */
export function reportsStockNowRowFields(product: Pick<Product, "name" | "stockOnHand" | "baseUnit">): {
  name: string;
  stockOnHand: number;
  baseUnit: string;
} {
  return {
    name: product.name,
    stockOnHand: product.stockOnHand,
    baseUnit: product.baseUnit,
  };
}
