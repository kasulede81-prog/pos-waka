import type { CatalogNode, PosShelfLayoutConfig, Product } from "../types";
import {
  LOCAL_CATALOG_SHOP_ID,
  catalogAncestors,
  catalogChildren,
  catalogDescendantIds,
  catalogNodesForShop,
} from "./catalogHierarchy";
import {
  QUICK_SELL_SHELF_KEY,
  collectShelfCategoryKeys,
  inferDefaultShelfColor,
  mergeShelfLayout,
  shelfHasUncategorizedSlot,
  type PosShelfDisplayCard,
} from "./posShelfLayout";
import { effectiveShelfOrderKeys } from "./posShelfOrder";
import { UNCATEGORIZED_SENTINEL, productMatchesCategoryFilter, shelfIconFor } from "./productCategories";

/** Browse path identity is `legacyShelfKey` (or the existing shelf key). Never a node UUID. */
export type CatalogBrowsePathEntry = {
  identity: string;
  label: string;
};

export type CatalogBrowseFolder = {
  identity: string;
  label: string;
  persisted: boolean;
  parentIdentity: string | null;
  sortOrder: number;
  /** Product count for this identity plus all descendant identities. Not stock units. */
  inclusiveProductCount: number;
};

export type CatalogBrowseLevel = {
  found: boolean;
  current: CatalogBrowsePathEntry | null;
  ancestors: CatalogBrowsePathEntry[];
  path: CatalogBrowsePathEntry[];
  folders: CatalogBrowseFolder[];
  /** Exact `Product.category` matches for the current identity only. Not descendants. */
  directProducts: Product[];
};

export type CatalogBrowseInput = {
  products: readonly Product[];
  layout: Record<string, PosShelfLayoutConfig>;
  orderKeys: readonly string[];
  nodes: readonly CatalogNode[];
  shopId: string;
  uncategorizedLabel?: string;
};

type CatalogBrowseIndexInternal = {
  layout: Record<string, PosShelfLayoutConfig>;
  orderKeys: string[];
  scoped: CatalogNode[];
  byId: Map<string, CatalogNode>;
  productsByIdentity: Map<string, Product[]>;
  uncategorizedProducts: Product[];
  countByIdentity: Map<string, number>;
  inclusiveCountByNodeId: Map<string, number>;
  legacyKeys: string[];
  hasUncategorized: boolean;
  uncategorizedLabel: string;
};

export type CatalogBrowseIndex = CatalogBrowseIndexInternal;

function sameShelfKey(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

function isReservedShelfKey(key: string): boolean {
  return key === QUICK_SELL_SHELF_KEY || key === UNCATEGORIZED_SENTINEL;
}

function byProductName(a: Product, b: Product): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function nodeRepresentsIdentity(nodes: readonly CatalogNode[], identity: string): boolean {
  return nodes.some((n) => sameShelfKey(n.legacyShelfKey, identity));
}

function findNodeByIdentity(scoped: readonly CatalogNode[], identity: string): CatalogNode | undefined {
  return scoped.find((n) => sameShelfKey(n.legacyShelfKey, identity));
}

function folderLabel(
  identity: string,
  node: CatalogNode | undefined,
  layout: Record<string, PosShelfLayoutConfig>,
  uncategorizedLabel: string,
): string {
  if (identity === UNCATEGORIZED_SENTINEL) return uncategorizedLabel;
  const layoutName = layout[identity]?.displayName?.trim();
  if (layoutName) return layoutName;
  if (node) {
    const nodeLayoutName = layout[node.legacyShelfKey]?.displayName?.trim();
    if (nodeLayoutName) return nodeLayoutName;
    const nodeName = node.name.trim();
    if (nodeName) return nodeName;
    return node.legacyShelfKey;
  }
  return identity;
}

function pathEntryForNode(
  node: CatalogNode,
  layout: Record<string, PosShelfLayoutConfig>,
  uncategorizedLabel: string,
): CatalogBrowsePathEntry {
  return {
    identity: node.legacyShelfKey,
    label: folderLabel(node.legacyShelfKey, node, layout, uncategorizedLabel),
  };
}

function productsForIdentity(index: CatalogBrowseIndexInternal, identity: string): Product[] {
  if (identity === UNCATEGORIZED_SENTINEL) {
    return [...index.uncategorizedProducts].sort(byProductName);
  }
  return [...(index.productsByIdentity.get(identity) ?? [])].sort(byProductName);
}

function inclusiveCountForIdentities(
  countByIdentity: Map<string, number>,
  identities: readonly string[],
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const identity of identities) {
    if (seen.has(identity)) continue;
    seen.add(identity);
    total += countByIdentity.get(identity) ?? 0;
  }
  return total;
}

function folderFromNode(index: CatalogBrowseIndexInternal, node: CatalogNode): CatalogBrowseFolder {
  const parent = node.parentId ? index.byId.get(node.parentId) : undefined;
  return {
    identity: node.legacyShelfKey,
    label: folderLabel(node.legacyShelfKey, node, index.layout, index.uncategorizedLabel),
    persisted: true,
    parentIdentity: parent?.legacyShelfKey ?? null,
    sortOrder: node.sortOrder,
    inclusiveProductCount: index.inclusiveCountByNodeId.get(node.id) ?? 0,
  };
}

function folderFromVirtual(
  index: CatalogBrowseIndexInternal,
  identity: string,
  sortOrder: number,
): CatalogBrowseFolder {
  const count =
    identity === UNCATEGORIZED_SENTINEL
      ? index.uncategorizedProducts.length
      : (index.countByIdentity.get(identity) ?? 0);
  return {
    identity,
    label: folderLabel(identity, undefined, index.layout, index.uncategorizedLabel),
    persisted: false,
    parentIdentity: null,
    sortOrder,
    inclusiveProductCount: count,
  };
}

function virtualRootKeys(index: CatalogBrowseIndexInternal): string[] {
  const unmatched = index.legacyKeys.filter((key) => !nodeRepresentsIdentity(index.scoped, key));
  return effectiveShelfOrderKeys(unmatched, index.orderKeys);
}

function rootFolders(index: CatalogBrowseIndexInternal): CatalogBrowseFolder[] {
  const persisted = catalogChildren(index.scoped, null).map((n) => folderFromNode(index, n));
  const virtual = virtualRootKeys(index).map((key, i) => folderFromVirtual(index, key, 10_000 + i));
  const folders = [...persisted, ...virtual];
  if (index.hasUncategorized) {
    folders.push(folderFromVirtual(index, UNCATEGORIZED_SENTINEL, 20_000));
  }
  return folders;
}

/**
 * Build identity / child / descendant indexes in one pass.
 * Resolve many folder levels from the same index — do not rescan the catalog per tap.
 */
export function buildCatalogBrowseIndex(input: CatalogBrowseInput): CatalogBrowseIndex {
  const shopId = input.shopId.trim() || LOCAL_CATALOG_SHOP_ID;
  const scoped = catalogNodesForShop(input.nodes, shopId);
  const layout = input.layout;
  const orderKeys = [...input.orderKeys];
  const products = input.products;
  const uncategorizedLabel = input.uncategorizedLabel?.trim() || "Uncategorized";

  const byId = new Map<string, CatalogNode>();
  for (const n of scoped) {
    byId.set(n.id, n);
  }

  const productsByIdentity = new Map<string, Product[]>();
  const uncategorizedProducts: Product[] = [];
  const countByIdentity = new Map<string, number>();
  for (const p of products) {
    const cat = (p.category ?? "").trim();
    if (!cat) {
      uncategorizedProducts.push(p);
      continue;
    }
    const list = productsByIdentity.get(cat) ?? [];
    list.push(p);
    productsByIdentity.set(cat, list);
    countByIdentity.set(cat, (countByIdentity.get(cat) ?? 0) + 1);
  }

  const legacyKeys = collectShelfCategoryKeys(products as Product[], orderKeys, layout).filter(
    (k) => !isReservedShelfKey(k),
  );
  const hasUncategorized = shelfHasUncategorizedSlot(products as Product[], orderKeys, layout);

  const inclusiveCountByNodeId = new Map<string, number>();
  for (const n of scoped) {
    const identities = [
      n.legacyShelfKey,
      ...catalogDescendantIds(scoped, n.id).map((id) => byId.get(id)?.legacyShelfKey).filter((key): key is string => Boolean(key)),
    ];
    inclusiveCountByNodeId.set(n.id, inclusiveCountForIdentities(countByIdentity, identities));
  }

  return {
    layout,
    orderKeys,
    scoped,
    byId,
    productsByIdentity,
    uncategorizedProducts,
    countByIdentity,
    inclusiveCountByNodeId,
    legacyKeys,
    hasUncategorized,
    uncategorizedLabel,
  };
}

function resolveUnknown(identity: string): CatalogBrowseLevel {
  return {
    found: false,
    current: { identity, label: identity },
    ancestors: [],
    path: [],
    folders: [],
    directProducts: [],
  };
}

/**
 * Resolve one browse level from a prebuilt index.
 * `currentIdentity` is a shelf identity (`legacyShelfKey`), never a node UUID. `null` is the root.
 */
export function resolveCatalogBrowseLevel(
  index: CatalogBrowseIndex,
  currentIdentity: string | null,
): CatalogBrowseLevel {
  if (currentIdentity == null || currentIdentity.trim() === "") {
    return {
      found: true,
      current: null,
      ancestors: [],
      path: [],
      folders: rootFolders(index),
      directProducts: [],
    };
  }

  const identity = currentIdentity.trim();
  if (identity === QUICK_SELL_SHELF_KEY) return resolveUnknown(identity);

  const node = findNodeByIdentity(index.scoped, identity);
  if (node) {
    const current = pathEntryForNode(node, index.layout, index.uncategorizedLabel);
    const ancestors = catalogAncestors(index.scoped, node.id).map((n) =>
      pathEntryForNode(n, index.layout, index.uncategorizedLabel),
    );
    const folders = catalogChildren(index.scoped, node.id).map((n) => folderFromNode(index, n));
    return {
      found: true,
      current,
      ancestors,
      path: [...ancestors, current],
      folders,
      directProducts: productsForIdentity(index, node.legacyShelfKey),
    };
  }

  if (identity === UNCATEGORIZED_SENTINEL && index.hasUncategorized) {
    const current = {
      identity: UNCATEGORIZED_SENTINEL,
      label: index.uncategorizedLabel,
    };
    return {
      found: true,
      current,
      ancestors: [],
      path: [current],
      folders: [],
      directProducts: productsForIdentity(index, UNCATEGORIZED_SENTINEL),
    };
  }

  const virtualKey =
    index.legacyKeys.find((k) => k === identity) ?? index.legacyKeys.find((k) => sameShelfKey(k, identity));
  if (virtualKey && !nodeRepresentsIdentity(index.scoped, virtualKey)) {
    const current = {
      identity: virtualKey,
      label: folderLabel(virtualKey, undefined, index.layout, index.uncategorizedLabel),
    };
    return {
      found: true,
      current,
      ancestors: [],
      path: [current],
      folders: [],
      directProducts: productsForIdentity(index, virtualKey),
    };
  }

  return resolveUnknown(identity);
}

/** Convenience for tests: build an index and resolve one level. */
export function resolveCatalogBrowse(
  input: CatalogBrowseInput,
  currentIdentity: string | null,
): CatalogBrowseLevel {
  return resolveCatalogBrowseLevel(buildCatalogBrowseIndex(input), currentIdentity);
}

export function catalogBrowsePathLabels(level: CatalogBrowseLevel): string[] {
  return level.path.map((entry) => entry.label);
}

/**
 * Direct-product membership uses the existing exact-category filter.
 * Exported so H2a tests can prove the resolver does not invent a second assignment truth.
 */
export function catalogBrowseProductMatchesIdentity(product: Product, identity: string): boolean {
  return productMatchesCategoryFilter(product, identity);
}

function folderMatchesIdentity(folder: CatalogBrowseFolder, identity: string): boolean {
  return sameShelfKey(folder.identity, identity);
}

/**
 * Keep a session path only while each step is still a child of the previous level.
 * Missing/renamed/deleted identities drop from that point (never leave the UI stuck).
 */
export function sanitizeCatalogBrowsePath(
  index: CatalogBrowseIndex,
  path: readonly string[],
): string[] {
  const out: string[] = [];
  for (const raw of path) {
    const identity = raw.trim();
    if (!identity || identity === QUICK_SELL_SHELF_KEY) break;
    const parent = out[out.length - 1] ?? null;
    const level = resolveCatalogBrowseLevel(index, parent);
    const folder = level.folders.find((f) => folderMatchesIdentity(f, identity));
    if (!folder) break;
    out.push(folder.identity);
  }
  return out;
}

/** Push a child identity onto the session path. Does not use browser history or UUIDs. */
export function pushCatalogBrowseIdentity(
  index: CatalogBrowseIndex,
  path: readonly string[],
  identity: string,
): string[] {
  const sanitized = sanitizeCatalogBrowsePath(index, path);
  const next = identity.trim();
  if (!next) return sanitized;
  const current = sanitized[sanitized.length - 1] ?? null;
  const level = resolveCatalogBrowseLevel(index, current);
  const folder = level.folders.find((f) => folderMatchesIdentity(f, next));
  if (folder) return [...sanitized, folder.identity];
  const found = resolveCatalogBrowseLevel(index, next);
  if (!found.found) return sanitized;
  return found.path.map((entry) => entry.identity);
}

export function popCatalogBrowseIdentity(path: readonly string[]): string[] {
  if (path.length === 0) return [];
  return path.slice(0, -1);
}

/** Jump to an ancestor (or rebuild the path for a still-valid identity). */
export function jumpCatalogBrowseToIdentity(
  index: CatalogBrowseIndex,
  path: readonly string[],
  identity: string | null,
): string[] {
  if (identity == null || identity.trim() === "") return [];
  const sanitized = sanitizeCatalogBrowsePath(index, path);
  const idx = sanitized.findIndex((id) => sameShelfKey(id, identity));
  if (idx >= 0) return sanitized.slice(0, idx + 1);
  const found = resolveCatalogBrowseLevel(index, identity.trim());
  if (!found.found) return sanitized;
  return found.path.map((entry) => entry.identity);
}

/** Map resolver folders to existing Sell tiles. Badge count is inclusive descendant products. */
export function catalogBrowseFoldersToShelfCards(
  folders: readonly CatalogBrowseFolder[],
  layout: Record<string, PosShelfLayoutConfig>,
  defaultScale = 35,
): PosShelfDisplayCard[] {
  return folders.map((folder, index) => {
    const base = {
      key: folder.identity,
      label: folder.label,
      count: folder.inclusiveProductCount,
      icon: shelfIconFor(folder.label) ?? shelfIconFor(folder.identity),
    };
    return mergeShelfLayout(base, layout[folder.identity], defaultScale, {
      fallbackColor: inferDefaultShelfColor(folder.identity, index),
    });
  });
}

export type SellCatalogHierarchyView = {
  atRoot: boolean;
  searchActive: boolean;
  path: CatalogBrowsePathEntry[];
  folders: CatalogBrowseFolder[];
  folderCards: PosShelfDisplayCard[];
  directProducts: Product[];
  currentIdentity: string | null;
  currentLabel: string | null;
};

/**
 * Flag-on mobile Sell view model. Returns null when hierarchy is off so flag-off
 * callers never route through the resolver.
 */
export function resolveSellCatalogHierarchyView(input: {
  enabled: boolean;
  path: readonly string[];
  searchQuery: string;
  index: CatalogBrowseIndex | null;
  layout: Record<string, PosShelfLayoutConfig>;
  defaultScale?: number;
}): SellCatalogHierarchyView | null {
  if (!input.enabled || !input.index) return null;
  const sanitized = sanitizeCatalogBrowsePath(input.index, input.path);
  const currentIdentity = sanitized[sanitized.length - 1] ?? null;
  const level = resolveCatalogBrowseLevel(input.index, currentIdentity);
  const searchActive = input.searchQuery.trim().length > 0;
  return {
    atRoot: currentIdentity == null,
    searchActive,
    path: level.path,
    folders: level.folders,
    folderCards: catalogBrowseFoldersToShelfCards(
      level.folders,
      input.layout,
      input.defaultScale,
    ),
    directProducts: level.directProducts,
    currentIdentity,
    currentLabel: level.current?.label ?? null,
  };
}
