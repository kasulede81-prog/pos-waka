import type { Product, ShopPreferences, StockMovement, Supplier } from "../../../types";
import { isLowStock } from "../../../lib/sellingEngine";
import { normalizedCategoryKey } from "../../../lib/productCategories";
import {
  INVENTORY_FILTER_ALL,
  type InventoryAdvancedFilters,
  type InventorySavedFilterPreset,
} from "./types";

const SUPPLIER_TAG_PREFIX = "supplier:";

export function readArchivedProductIds(preferences: ShopPreferences): Set<string> {
  return new Set(preferences.inventoryArchivedProductIds ?? []);
}

export function readProductTags(preferences: ShopPreferences): Record<string, string[]> {
  return preferences.inventoryProductTags ?? {};
}

export function readSavedFilterPresets(preferences: ShopPreferences): InventorySavedFilterPreset[] {
  return preferences.inventorySavedFilters ?? [];
}

export function writeArchivedProductIds(
  _preferences: ShopPreferences,
  ids: string[],
): Partial<ShopPreferences> {
  return { inventoryArchivedProductIds: ids };
}

export function writeProductTags(
  _preferences: ShopPreferences,
  tags: Record<string, string[]>,
): Partial<ShopPreferences> {
  return { inventoryProductTags: tags };
}

export function writeSavedFilterPresets(
  _preferences: ShopPreferences,
  presets: InventorySavedFilterPreset[],
): Partial<ShopPreferences> {
  return { inventorySavedFilters: presets };
}

/** Last known supplier per product from stock movements (productivity filter only). */
export function buildLastSupplierByProductId(
  movements: readonly StockMovement[],
  supplierNames: Map<string, string> = new Map(),
): Map<string, { supplierId: string; supplierName: string }> {
  const m = new Map<string, { supplierId: string; supplierName: string; at: number }>();
  for (const mv of movements) {
    if (!mv.supplierId || mv.deltaBaseUnits <= 0) continue;
    const at = new Date(mv.at).getTime();
    const prev = m.get(mv.productId);
    if (!prev || at > prev.at) {
      m.set(mv.productId, {
        supplierId: mv.supplierId,
        supplierName: supplierNames.get(mv.supplierId) ?? "",
        at,
      });
    }
  }
  const out = new Map<string, { supplierId: string; supplierName: string }>();
  for (const [pid, v] of m) {
    out.set(pid, { supplierId: v.supplierId, supplierName: v.supplierName });
  }
  return out;
}

export function productBrandLabel(p: Product): string {
  return p.pharmacyMaster?.brandName?.trim() ?? "";
}

export function productSupplierTag(supplierId: string): string {
  return `${SUPPLIER_TAG_PREFIX}${supplierId}`;
}

export function parseSupplierTag(tag: string): string | null {
  if (!tag.startsWith(SUPPLIER_TAG_PREFIX)) return null;
  return tag.slice(SUPPLIER_TAG_PREFIX.length) || null;
}

export function productTagsForId(preferences: ShopPreferences, productId: string): string[] {
  return readProductTags(preferences)[productId] ?? [];
}

export function isProductArchived(preferences: ShopPreferences, productId: string): boolean {
  return readArchivedProductIds(preferences).has(productId);
}

export function isProductInactive(p: Product): boolean {
  return p.menu?.hideFromMenu === true;
}

function withinDays(iso: string | undefined, days: number | null): boolean {
  if (days == null) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  const cutoff = Date.now() - days * 86_400_000;
  return t >= cutoff;
}

export type InventoryFilterContext = {
  preferences: ShopPreferences;
  lastSupplierByProductId: Map<string, { supplierId: string; supplierName: string }>;
};

export function productMatchesAdvancedFilters(
  p: Product,
  filters: InventoryAdvancedFilters,
  ctx: InventoryFilterContext,
): boolean {
  const archived = isProductArchived(ctx.preferences, p.id);
  const inactive = isProductInactive(p);

  if (filters.active === "active" && (archived || inactive)) return false;
  if (filters.active === "archived" && !archived) return false;
  if (filters.active === "inactive" && !inactive) return false;

  if (filters.category !== INVENTORY_FILTER_ALL) {
    const cat = normalizedCategoryKey(p) || "";
    if (cat !== filters.category && p.category !== filters.category) return false;
  }

  if (filters.shelf !== INVENTORY_FILTER_ALL) {
    const shelf = normalizedCategoryKey(p) || "";
    if (shelf !== filters.shelf) return false;
  }

  if (filters.supplierId !== INVENTORY_FILTER_ALL) {
    const last = ctx.lastSupplierByProductId.get(p.id);
    const tagMatch = productTagsForId(ctx.preferences, p.id).some(
      (t) => parseSupplierTag(t) === filters.supplierId,
    );
    if (last?.supplierId !== filters.supplierId && !tagMatch) return false;
  }

  if (filters.brand !== INVENTORY_FILTER_ALL) {
    const brand = productBrandLabel(p);
    if (brand.toLowerCase() !== filters.brand.toLowerCase()) return false;
  }

  if (filters.stock === "low" && !isLowStock(p)) return false;
  if (filters.stock === "out" && p.stockOnHand > 0) return false;

  const price = p.sellingPricePerUnitUgx;
  if (filters.priceMinUgx != null && price < filters.priceMinUgx) return false;
  if (filters.priceMaxUgx != null && price > filters.priceMaxUgx) return false;

  const cost = p.costPricePerUnitUgx;
  if (filters.costMinUgx != null && cost < filters.costMinUgx) return false;
  if (filters.costMaxUgx != null && cost > filters.costMaxUgx) return false;

  if (!withinDays(p.updatedAt, filters.updatedWithinDays)) return false;

  if (filters.tags.length > 0) {
    const tags = new Set(productTagsForId(ctx.preferences, p.id));
    for (const req of filters.tags) {
      if (!tags.has(req)) return false;
    }
  }

  return true;
}

export function distinctBrands(products: readonly Product[]): string[] {
  const s = new Set<string>();
  for (const p of products) {
    const b = productBrandLabel(p);
    if (b) s.add(b);
  }
  return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function distinctSuppliersForFilter(
  suppliers: readonly Supplier[],
  lastSupplierByProductId: Map<string, { supplierId: string; supplierName: string }>,
): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const s of suppliers) m.set(s.id, s.name);
  for (const v of lastSupplierByProductId.values()) {
    if (v.supplierId) m.set(v.supplierId, (v.supplierName || m.get(v.supplierId)) ?? v.supplierId);
  }
  return [...m.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
