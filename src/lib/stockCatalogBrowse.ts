import type { BusinessType, CatalogNode, PosShelfLayoutConfig, Product, ShopPreferences } from "../types";
import {
  catalogShopIdFromPreferences,
  isCatalogHierarchyEnabled,
} from "./catalogHierarchy";
import {
  buildCatalogBrowseIndex,
  resolveSellCatalogHierarchyView,
  type CatalogBrowseIndex,
  type SellCatalogHierarchyView,
} from "./catalogBrowse";
import { defaultMenuCategoriesForBusinessType, isHospitalityMode } from "./hospitality";
import { defaultPharmacyCategoriesForBusinessType } from "./pharmacy";
import {
  QUICK_SELL_SHELF_KEY,
  collectShelfCategoryKeys,
} from "./posShelfLayout";
import {
  UNCATEGORIZED_SENTINEL,
  distinctTrimmedCategories,
  normalizedCategoryKey,
} from "./productCategories";

export type StockShelfFolderTile = {
  key: string;
  label: string;
  count: number;
};

export type StockLegacyShelfInput = {
  products: readonly Product[];
  savedShelfKeys: readonly string[];
  layout: Record<string, PosShelfLayoutConfig>;
  businessType: BusinessType | undefined | null;
  hospitalityModeEnabled?: boolean | null;
  pharmacyMode: boolean;
};

/** Exact flag-off Stock category picklist. Do not route this through catalogBrowse. */
export function stockLegacyCategoryPicklist(input: StockLegacyShelfInput): string[] {
  const fromProducts = distinctTrimmedCategories(input.products as Product[]);
  const fromSaved = input.savedShelfKeys.filter((k) => k && k !== UNCATEGORIZED_SENTINEL);
  if (isHospitalityMode(input.businessType, input.hospitalityModeEnabled)) {
    const presets = defaultMenuCategoriesForBusinessType(input.businessType);
    return [...new Set([...fromProducts, ...fromSaved, ...presets])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }
  if (input.pharmacyMode) {
    const presets = defaultPharmacyCategoriesForBusinessType(input.businessType);
    return [...new Set([...fromProducts, ...fromSaved, ...presets])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }
  return collectShelfCategoryKeys(
    input.products as Product[],
    [...input.savedShelfKeys],
    input.layout,
  );
}

/** Flag-off shelf folder keys: picklist plus uncategorized, uncategorized last. */
export function stockLegacyShelfFolderKeys(
  picklist: readonly string[],
  hasUncategorized: boolean,
): string[] {
  const keys = [...picklist];
  if (hasUncategorized) keys.push(UNCATEGORIZED_SENTINEL);
  return keys.sort((a, b) => {
    if (a === UNCATEGORIZED_SENTINEL) return 1;
    if (b === UNCATEGORIZED_SENTINEL) return -1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

/** Direct Product.category counts — not stock units, not inclusive descendants. */
export function stockDirectProductCountsByCategory(products: readonly Product[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of products) {
    const g = normalizedCategoryKey(p) || UNCATEGORIZED_SENTINEL;
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/**
 * Extra identities fed to the shared resolver as virtual roots.
 * Presets stay strings — they are never written to posCatalogNodes.
 */
export function stockHierarchyBrowseOrderKeys(input: {
  savedShelfKeys: readonly string[];
  businessType: BusinessType | undefined | null;
  hospitalityModeEnabled?: boolean | null;
  pharmacyMode: boolean;
}): string[] {
  const saved = input.savedShelfKeys.filter((k) => k && k !== QUICK_SELL_SHELF_KEY);
  let presets: string[] = [];
  if (isHospitalityMode(input.businessType, input.hospitalityModeEnabled)) {
    presets = defaultMenuCategoriesForBusinessType(input.businessType);
  } else if (input.pharmacyMode) {
    presets = defaultPharmacyCategoriesForBusinessType(input.businessType);
  }
  return [...new Set([...saved, ...presets])].filter((k) => k !== QUICK_SELL_SHELF_KEY);
}

export function buildStockCatalogBrowseIndex(input: {
  products: readonly Product[];
  layout: Record<string, PosShelfLayoutConfig>;
  nodes: readonly CatalogNode[];
  shopId: string;
  orderKeys: readonly string[];
  uncategorizedLabel: string;
}): CatalogBrowseIndex {
  return buildCatalogBrowseIndex({
    products: input.products as Product[],
    layout: input.layout,
    orderKeys: [...input.orderKeys],
    nodes: input.nodes,
    shopId: input.shopId,
    uncategorizedLabel: input.uncategorizedLabel,
  });
}

export function resolveStockCatalogHierarchyView(input: {
  enabled: boolean;
  path: readonly string[];
  index: CatalogBrowseIndex | null;
  layout: Record<string, PosShelfLayoutConfig>;
}): SellCatalogHierarchyView | null {
  if (input.enabled !== true) return null;
  return resolveSellCatalogHierarchyView({
    enabled: true,
    path: input.path,
    searchQuery: "",
    index: input.index,
    layout: input.layout,
  });
}

export function stockHierarchyFolderTiles(view: SellCatalogHierarchyView): StockShelfFolderTile[] {
  return view.folderCards.map((card) => ({
    key: card.key,
    label: card.label,
    count: card.count,
  }));
}

/** Inclusive product count for the open folder (direct + descendants). Not stockOnHand. */
export function stockHierarchyCurrentInclusiveCount(view: SellCatalogHierarchyView): number {
  return (
    view.directProducts.length + view.folders.reduce((n, folder) => n + folder.inclusiveProductCount, 0)
  );
}

export function stockCatalogShopId(preferences: Pick<ShopPreferences, "wakaShopId">): string {
  return catalogShopIdFromPreferences(preferences);
}

export function stockHierarchyEnabled(
  preferences: Pick<ShopPreferences, "catalogHierarchyEnabled"> | null | undefined,
): boolean {
  return isCatalogHierarchyEnabled(preferences);
}
