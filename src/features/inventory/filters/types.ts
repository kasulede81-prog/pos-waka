/** Advanced inventory filter model — productivity layer only. */

export type InventoryStockFilter = "all" | "low" | "out";

export type InventoryActiveFilter = "all" | "active" | "archived" | "inactive";

export type InventoryAdvancedFilters = {
  category: string;
  supplierId: string;
  shelf: string;
  brand: string;
  stock: InventoryStockFilter;
  active: InventoryActiveFilter;
  priceMinUgx: number | null;
  priceMaxUgx: number | null;
  costMinUgx: number | null;
  costMaxUgx: number | null;
  updatedWithinDays: number | null;
  createdWithinDays: number | null;
  tags: string[];
};

export type InventorySavedFilterPreset = {
  id: string;
  name: string;
  filters: Partial<InventoryAdvancedFilters>;
  query: string;
  createdAt: string;
};

export const INVENTORY_FILTER_ALL = "__waka_all__";

export function defaultInventoryAdvancedFilters(categoryAll = INVENTORY_FILTER_ALL): InventoryAdvancedFilters {
  return {
    category: categoryAll,
    supplierId: INVENTORY_FILTER_ALL,
    shelf: INVENTORY_FILTER_ALL,
    brand: INVENTORY_FILTER_ALL,
    stock: "all",
    active: "active",
    priceMinUgx: null,
    priceMaxUgx: null,
    costMinUgx: null,
    costMaxUgx: null,
    updatedWithinDays: null,
    createdWithinDays: null,
    tags: [],
  };
}

export function mergeAdvancedFilters(
  base: InventoryAdvancedFilters,
  patch: Partial<InventoryAdvancedFilters>,
): InventoryAdvancedFilters {
  return { ...base, ...patch, tags: patch.tags ?? base.tags };
}

export function countActiveAdvancedFilters(filters: InventoryAdvancedFilters): number {
  let n = 0;
  if (filters.category !== INVENTORY_FILTER_ALL) n += 1;
  if (filters.supplierId !== INVENTORY_FILTER_ALL) n += 1;
  if (filters.shelf !== INVENTORY_FILTER_ALL) n += 1;
  if (filters.brand !== INVENTORY_FILTER_ALL) n += 1;
  if (filters.stock !== "all") n += 1;
  if (filters.active !== "active") n += 1;
  if (filters.priceMinUgx != null) n += 1;
  if (filters.priceMaxUgx != null) n += 1;
  if (filters.costMinUgx != null) n += 1;
  if (filters.costMaxUgx != null) n += 1;
  if (filters.updatedWithinDays != null) n += 1;
  if (filters.createdWithinDays != null) n += 1;
  if (filters.tags.length > 0) n += 1;
  return n;
}
