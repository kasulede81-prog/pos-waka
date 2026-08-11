import { useMemo, useRef } from "react";
import type { Product, ShopPreferences, StockMovement } from "../types";
import {
  reconcileProductSellSearchIndex,
  type ProductSellSearchIndex,
} from "../lib/posProductSearch";
import {
  reconcileInventorySearchIndex,
  type InventorySearchIndex,
} from "../features/inventory/viewEngine/inventoryProductListQuery";

/**
 * Sell search index that upserts only changed products between catalog revisions (Phase 36.1).
 */
export function useReconciledProductSellSearchIndex(products: readonly Product[]): ProductSellSearchIndex {
  const cacheRef = useRef<{
    products: readonly Product[];
    index: ProductSellSearchIndex;
  } | null>(null);

  return useMemo(() => {
    const prev = cacheRef.current;
    const index = reconcileProductSellSearchIndex(prev?.index, prev?.products, products);
    cacheRef.current = { products, index };
    return index;
  }, [products]);
}

/**
 * Inventory search index with incremental product updates (Phase 36.1).
 */
export function useReconciledInventorySearchIndex(
  products: readonly Product[],
  preferences: ShopPreferences,
  stockMovements: readonly StockMovement[],
): InventorySearchIndex {
  const cacheRef = useRef<{
    products: readonly Product[];
    preferences: ShopPreferences;
    stockMovements: readonly StockMovement[];
    index: InventorySearchIndex;
  } | null>(null);

  return useMemo(() => {
    const prev = cacheRef.current;
    const index = reconcileInventorySearchIndex(
      prev?.index,
      prev?.products,
      products,
      preferences,
      stockMovements,
      prev?.preferences,
      prev?.stockMovements,
    );
    cacheRef.current = { products, preferences, stockMovements, index };
    return index;
  }, [products, preferences, stockMovements]);
}
