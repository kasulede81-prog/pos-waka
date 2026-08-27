import type { BusinessType, CatalogNode, PosShelfLayoutConfig, Product } from "../types";
import {
  catalogAncestors,
  catalogChildren,
  catalogNodesForShop,
  LOCAL_CATALOG_SHOP_ID,
  VIRTUAL_NODE_PREFIX,
} from "./catalogHierarchy";
import {
  isReservedEmptyShelfKey,
  sameShelfIdentity,
  shelfIdentityIsOccupied,
} from "./deleteEmptyShelf";
import { defaultMenuCategoriesForBusinessType } from "./hospitality";
import { PHARMACY_CATEGORY_PRESETS } from "./pharmacy";
import { collectShelfCategoryKeys } from "./posShelfLayout";

export type EmptyShelfSkipReason = "occupied" | "reserved" | "preset" | "hasChildren" | "emptyKey";

export type EmptyShelfRow = {
  key: string;
  label: string;
  pathLabels: string[];
  pathText: string;
  productCount: number;
  occupied: boolean;
  hasChildFolders: boolean;
  presetProtected: boolean;
  reserved: boolean;
  /** Selectable for bulk delete. */
  deletable: boolean;
};

export type ListEmptyShelfRowsInput = {
  products: readonly Product[];
  layout: Record<string, PosShelfLayoutConfig>;
  orderKeys: readonly string[];
  nodes?: readonly CatalogNode[];
  hierarchyEnabled?: boolean;
  shopId?: string;
  pharmacyMode?: boolean;
  hospitalityMode?: boolean;
  businessType?: BusinessType | null;
};

export function protectedPresetShelfIdentities(input: {
  pharmacyMode?: boolean;
  hospitalityMode?: boolean;
  businessType?: BusinessType | null;
}): string[] {
  const out: string[] = [];
  if (input.pharmacyMode) out.push(...PHARMACY_CATEGORY_PRESETS);
  if (input.hospitalityMode) out.push(...defaultMenuCategoriesForBusinessType(input.businessType));
  return out;
}

export function isProtectedPresetShelfIdentity(
  key: string,
  input: {
    pharmacyMode?: boolean;
    hospitalityMode?: boolean;
    businessType?: BusinessType | null;
  },
): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  return protectedPresetShelfIdentities(input).some((preset) => sameShelfIdentity(preset, trimmed));
}

export function catalogIdentityHasChildFolders(
  nodes: readonly CatalogNode[],
  shopId: string,
  shelfKey: string,
): boolean {
  const key = shelfKey.trim();
  if (!key) return false;
  const scoped = catalogNodesForShop(nodes, shopId);
  const matching = scoped.filter(
    (n) => sameShelfIdentity(n.legacyShelfKey, key) || sameShelfIdentity(n.name, key),
  );
  return matching.some((n) => catalogChildren(scoped, n.id).length > 0);
}

function matchingCatalogNode(
  scoped: readonly CatalogNode[],
  key: string,
): CatalogNode | undefined {
  return scoped.find((n) => sameShelfIdentity(n.legacyShelfKey, key) || sameShelfIdentity(n.name, key));
}

function pathLabelsForIdentity(scoped: readonly CatalogNode[], key: string): string[] {
  const node = matchingCatalogNode(scoped, key);
  if (!node) return [key];
  return [...catalogAncestors(scoped, node.id).map((n) => n.name), node.name];
}

function firstMatchingLayoutKey(
  layout: Record<string, PosShelfLayoutConfig>,
  key: string,
): string | undefined {
  return Object.keys(layout).find((k) => sameShelfIdentity(k, key));
}

/**
 * Empty catalog presentation identities. Occupancy matches `planDeleteEmptyShelf`
 * (case-insensitive, includes archived rows still in `products`).
 */
export function listEmptyShelfRows(input: ListEmptyShelfRowsInput): EmptyShelfRow[] {
  const hierarchyEnabled = input.hierarchyEnabled === true;
  const shopId = input.shopId?.trim() || LOCAL_CATALOG_SHOP_ID;
  const scoped = hierarchyEnabled ? catalogNodesForShop(input.nodes ?? [], shopId) : [];
  const layout = input.layout ?? {};
  const orderKeys = input.orderKeys ?? [];

  const raw: string[] = [
    ...Object.keys(layout),
    ...orderKeys,
    ...collectShelfCategoryKeys(input.products as Product[], [...orderKeys], layout),
  ];
  if (hierarchyEnabled) {
    for (const n of scoped) raw.push(n.legacyShelfKey);
  }

  const unique: string[] = [];
  for (const candidate of raw) {
    const key = candidate.trim();
    if (!key) continue;
    if (key.startsWith(VIRTUAL_NODE_PREFIX)) continue;
    if (isReservedEmptyShelfKey(key)) continue;
    if (unique.some((u) => sameShelfIdentity(u, key))) continue;
    unique.push(key);
  }

  const rows: EmptyShelfRow[] = [];
  for (const key of unique) {
    const occupied = shelfIdentityIsOccupied(input.products, key);
    if (occupied) continue;

    const node = matchingCatalogNode(scoped, key);
    const layoutKey = firstMatchingLayoutKey(layout, key);
    const canonical =
      (hierarchyEnabled && node?.legacyShelfKey?.trim()) || layoutKey || key;
    const label =
      (layoutKey ? layout[layoutKey]?.displayName?.trim() : "") ||
      node?.name?.trim() ||
      canonical;
    const pathLabels = hierarchyEnabled ? pathLabelsForIdentity(scoped, canonical) : [label];
    const hasChildFolders =
      hierarchyEnabled && catalogIdentityHasChildFolders(input.nodes ?? [], shopId, canonical);
    const presetProtected = isProtectedPresetShelfIdentity(canonical, input);
    const productCount = input.products.reduce((n, p) => {
      const cat = (p.category ?? "").trim();
      return cat && sameShelfIdentity(cat, canonical) ? n + 1 : n;
    }, 0);

    rows.push({
      key: canonical,
      label,
      pathLabels,
      pathText: pathLabels.join(" / "),
      productCount,
      occupied: false,
      hasChildFolders,
      presetProtected,
      reserved: false,
      deletable: !hasChildFolders && !presetProtected,
    });
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

export type PlanRefillEmptyShelfOk = {
  ok: true;
  destinationKey: string;
  moveIds: string[];
  skippedMissing: string[];
  skippedAlready: string[];
};

export type PlanRefillEmptyShelfErr = {
  ok: false;
  errorKey: "shelfDeleteEmpty" | "shelfDeleteReserved";
};

export type PlanRefillEmptyShelfResult = PlanRefillEmptyShelfOk | PlanRefillEmptyShelfErr;

/** Catalog-only move plan. Never touches stock, SKU, barcode, or product ids. */
export function planRefillEmptyShelf(input: {
  destinationKey: string;
  productIds: readonly string[];
  products: readonly Product[];
}): PlanRefillEmptyShelfResult {
  const destinationKey = input.destinationKey.trim();
  if (!destinationKey) return { ok: false, errorKey: "shelfDeleteEmpty" };
  if (isReservedEmptyShelfKey(destinationKey)) return { ok: false, errorKey: "shelfDeleteReserved" };

  const byId = new Map(input.products.map((p) => [p.id, p]));
  const moveIds: string[] = [];
  const skippedMissing: string[] = [];
  const skippedAlready: string[] = [];
  const seen = new Set<string>();

  for (const rawId of input.productIds) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const product = byId.get(id);
    if (!product) {
      skippedMissing.push(id);
      continue;
    }
    const cat = (product.category ?? "").trim();
    if (cat && sameShelfIdentity(cat, destinationKey)) {
      skippedAlready.push(id);
      continue;
    }
    moveIds.push(id);
  }

  return { ok: true, destinationKey, moveIds, skippedMissing, skippedAlready };
}

export function filterProductsForEmptyShelfRefill(
  products: readonly Product[],
  destinationKey: string,
  query: string,
): Product[] {
  const dest = destinationKey.trim();
  const q = query.trim().toLowerCase();
  const rows = products.filter((p) => {
    const cat = (p.category ?? "").trim();
    if (dest && cat && sameShelfIdentity(cat, dest)) return false;
    if (!q) return true;
    const barcodes = p.pharmacyMaster?.barcodes?.join(" ") ?? "";
    const hay = `${p.name} ${p.sku} ${cat} ${barcodes}`.toLowerCase();
    return hay.includes(q);
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
