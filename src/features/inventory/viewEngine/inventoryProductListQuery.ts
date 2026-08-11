import type { Product, ShopPreferences, StockMovement } from "../../../types";
import {
  buildProductSellSearchIndex,
  productMatchesIndexedSellSearch,
  reconcileProductSellSearchIndex,
  type ProductSellSearchIndex,
} from "../../../lib/posProductSearch";
import { productMatchesCategoryFilter } from "../../../lib/productCategories";
import { isLowStock } from "../../../lib/sellingEngine";
import type { InventoryListSortKey } from "../viewEngine/types";
import type { InventoryAdvancedFilters } from "../filters/types";
import type { InventoryFilterContext } from "../filters/inventoryAdvancedFilters";
import {
  buildLastSupplierByProductId,
  productBrandLabel,
  productMatchesAdvancedFilters,
  productTagsForId,
} from "../filters/inventoryAdvancedFilters";

export type InventoryListQueryInput = {
  products: readonly Product[];
  query: string;
  categoryFilter: string;
  listFilter: "all" | "low";
  sort: InventoryListSortKey;
  index?: ProductSellSearchIndex;
  advancedFilters?: InventoryAdvancedFilters;
  filterContext?: InventoryFilterContext;
  stockMovements?: readonly StockMovement[];
};

export type InventorySearchIndex = ProductSellSearchIndex & {
  /** Extra hay for inventory-only fields (supplier, tags, brand). */
  inventoryHayById: Map<string, string>;
};

function normalizeSpacing(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function inventoryHayForProduct(
  entryHay: string,
  entryHayLoose: string,
  product: Product,
  preferences: ShopPreferences,
  lastSupplier: ReturnType<typeof buildLastSupplierByProductId>,
): string {
  const parts = [entryHay, entryHayLoose];
  const brand = productBrandLabel(product);
  if (brand) parts.push(normalizeSpacing(brand));
  const supplier = lastSupplier.get(product.id);
  if (supplier?.supplierName) parts.push(normalizeSpacing(supplier.supplierName));
  for (const tag of productTagsForId(preferences, product.id)) {
    parts.push(normalizeSpacing(tag.replace("supplier:", "supplier ")));
  }
  return parts.join(" · ");
}

/** Build search index with inventory enrichment — still uses certified POS index core. */
export function buildInventorySearchIndex(
  products: readonly Product[],
  preferences: ShopPreferences,
  movements: readonly StockMovement[] = [],
): InventorySearchIndex {
  const base = buildProductSellSearchIndex(products);
  const lastSupplier = buildLastSupplierByProductId(movements);
  const inventoryHayById = new Map<string, string>();

  for (const entry of base.entries) {
    inventoryHayById.set(
      entry.product.id,
      inventoryHayForProduct(entry.hay, entry.hayLoose, entry.product, preferences, lastSupplier),
    );
  }

  return { ...base, inventoryHayById };
}

/**
 * Incremental inventory index update (Phase 36.1).
 * Full rebuild when preferences/movements change; otherwise upserts only touched products.
 */
export function reconcileInventorySearchIndex(
  prev: InventorySearchIndex | null | undefined,
  prevProducts: readonly Product[] | null | undefined,
  nextProducts: readonly Product[],
  preferences: ShopPreferences,
  movements: readonly StockMovement[] = [],
  prevPreferences?: ShopPreferences,
  prevMovements?: readonly StockMovement[],
): InventorySearchIndex {
  if (
    !prev ||
    !prevProducts ||
    preferences !== prevPreferences ||
    movements !== prevMovements
  ) {
    return buildInventorySearchIndex(nextProducts, preferences, movements);
  }
  if (prevProducts === nextProducts) return prev;

  const base = reconcileProductSellSearchIndex(prev, prevProducts, nextProducts);
  const lastSupplier = buildLastSupplierByProductId(movements);
  const inventoryHayById = new Map(prev.inventoryHayById);
  const prevById = new Map(prevProducts.map((p) => [p.id, p]));

  for (const p of prevProducts) {
    if (!base.byId.has(p.id)) inventoryHayById.delete(p.id);
  }
  for (const p of nextProducts) {
    if (prevById.get(p.id) === p && inventoryHayById.has(p.id)) continue;
    const entry = base.byId.get(p.id);
    if (!entry) continue;
    inventoryHayById.set(
      p.id,
      inventoryHayForProduct(entry.hay, entry.hayLoose, p, preferences, lastSupplier),
    );
  }

  return { ...base, inventoryHayById };
}

function matchesInventorySearch(
  index: InventorySearchIndex,
  product: Product,
  query: string,
): boolean {
  if (productMatchesIndexedSellSearch(index, product, query, [])) return true;
  const q = normalizeSpacing(query);
  if (!q) return true;
  const extra = index.inventoryHayById.get(product.id) ?? "";
  return extra.includes(q);
}

function sortProducts(list: Product[], sort: InventoryListSortKey): Product[] {
  return [...list].sort((a, b) => {
    if (sort === "name_az") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (sort === "name_za") return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
    if (sort === "stock_low") {
      const d = a.stockOnHand - b.stockOnHand;
      return d !== 0 ? d : a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    const ta = new Date(a.updatedAt).getTime();
    const tb = new Date(b.updatedAt).getTime();
    return tb - ta || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function passesLegacyListFilter(p: Product, listFilter: "all" | "low"): boolean {
  if (listFilter === "low" && !isLowStock(p)) return false;
  return true;
}

/** Single-pass inventory list pipeline using certified POS search index + advanced filters. */
export function queryInventoryProducts(input: InventoryListQueryInput): Product[] {
  const q = input.query.trim();
  const baseIndex = input.index ?? buildProductSellSearchIndex(input.products);
  const index: InventorySearchIndex =
    "inventoryHayById" in baseIndex
      ? (baseIndex as InventorySearchIndex)
      : input.filterContext && input.stockMovements
        ? buildInventorySearchIndex(input.products, input.filterContext.preferences, input.stockMovements)
        : { ...baseIndex, inventoryHayById: new Map() };

  const adv = input.advancedFilters;
  const ctx = input.filterContext;
  const filtered: Product[] = [];

  const iterate = (product: Product) => {
    if (!passesLegacyListFilter(product, input.listFilter)) return;
    if (!productMatchesCategoryFilter(product, input.categoryFilter)) return;
    if (adv && ctx && !productMatchesAdvancedFilters(product, adv, ctx)) return;
    filtered.push(product);
  };

  if (!q) {
    for (const p of input.products) iterate(p);
  } else {
    for (const entry of index.entries) {
      const p = entry.product;
      if (!matchesInventorySearch(index, p, q)) continue;
      iterate(p);
    }
  }

  return sortProducts(filtered, input.sort);
}

export { buildProductSellSearchIndex, type ProductSellSearchIndex };
