import type { Product } from "../types";

/** Opening stock for “Duplicate as new” / “Copy to edit” — catalog clone, not warehouse clone. */
export const DUPLICATE_OPENING_STOCK = 0;

export type CatalogDuplicatePrefill = {
  name: string;
  category: string;
  sellingPricePerUnitUgx: number;
  stockOnHand: typeof DUPLICATE_OPENING_STOCK;
  costPricePerUnitUgx: number | null;
};

/**
 * Fields the duplicate UX copies. Never copies live stock, movements, purchases, or batches.
 */
export function catalogDuplicatePrefill(
  source: Pick<Product, "name" | "category" | "sellingPricePerUnitUgx" | "costPricePerUnitUgx">,
  nameSuffix: string,
): CatalogDuplicatePrefill {
  const cost = Number(source.costPricePerUnitUgx);
  return {
    name: `${source.name}${nameSuffix}`,
    category: (source.category ?? "").trim(),
    sellingPricePerUnitUgx: Math.max(0, Math.floor(Number(source.sellingPricePerUnitUgx) || 0)),
    stockOnHand: DUPLICATE_OPENING_STOCK,
    costPricePerUnitUgx: Number.isFinite(cost) && cost > 0 ? cost : null,
  };
}
