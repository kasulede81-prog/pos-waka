import type { CatalogNode, PosShelfLayoutConfig, Product, ShopPreferences } from "../types";
import { UNCATEGORIZED_SENTINEL } from "./productCategories";
import {
  QUICK_SELL_SHELF_KEY,
  collectShelfCategoryKeys,
  fillDefaultShelfLayout,
} from "./posShelfLayout";
import { normalizeShelfName } from "./renameShelfCategory";

export const CATALOG_NODES_MAX = 400;
export const VIRTUAL_NODE_PREFIX = "virtual:";
export const LOCAL_CATALOG_SHOP_ID = "local";

export type CatalogPickerItem = {
  id: string;
  parentId: string | null;
  name: string;
  legacyShelfKey: string;
  depth: number;
  pathLabels: string[];
  persisted: boolean;
  sortOrder: number;
};

export function isCatalogHierarchyEnabled(
  prefs: Pick<ShopPreferences, "catalogHierarchyEnabled"> | null | undefined,
): boolean {
  return prefs?.catalogHierarchyEnabled === true;
}

export function catalogShopIdFromPreferences(
  prefs: Pick<ShopPreferences, "wakaShopId"> | null | undefined,
): string {
  const id = prefs?.wakaShopId?.trim();
  return id || LOCAL_CATALOG_SHOP_ID;
}

function sameShelfKey(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

function isReservedShelfKey(key: string): boolean {
  return key === QUICK_SELL_SHELF_KEY || key === UNCATEGORIZED_SENTINEL;
}

export function catalogNodesForShop(nodes: readonly CatalogNode[], shopId: string): CatalogNode[] {
  const sid = shopId.trim() || LOCAL_CATALOG_SHOP_ID;
  return nodes.filter((n) => (n.shopId.trim() || LOCAL_CATALOG_SHOP_ID) === sid);
}

export function normalizeCatalogNodes(raw: unknown, shopId = LOCAL_CATALOG_SHOP_ID): CatalogNode[] {
  if (!Array.isArray(raw)) return [];
  const fallbackShop = shopId.trim() || LOCAL_CATALOG_SHOP_ID;
  const out: CatalogNode[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const legacyShelfKey = normalizeShelfName(String(o.legacyShelfKey ?? o.name ?? ""));
    if (!id || !legacyShelfKey || isReservedShelfKey(legacyShelfKey) || seen.has(id)) continue;
    const parentRaw = o.parentId == null || o.parentId === "" ? null : String(o.parentId).trim();
    const parentId = parentRaw && parentRaw !== id ? parentRaw : null;
    const name = normalizeShelfName(String(o.name ?? legacyShelfKey)) || legacyShelfKey;
    const sortOrder = Number.isFinite(Number(o.sortOrder)) ? Math.max(0, Math.floor(Number(o.sortOrder))) : out.length;
    const createdAt = String(o.createdAt ?? "").trim() || new Date().toISOString();
    const updatedAt = String(o.updatedAt ?? "").trim() || createdAt;
    const nodeShop = String(o.shopId ?? "").trim() || fallbackShop;
    seen.add(id);
    out.push({
      id,
      shopId: nodeShop,
      parentId,
      legacyShelfKey,
      name,
      sortOrder,
      createdAt,
      updatedAt,
    });
    if (out.length >= CATALOG_NODES_MAX) break;
  }
  return dropCyclicParents(out);
}

function dropCyclicParents(nodes: CatalogNode[]): CatalogNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((n) => {
    if (!n.parentId || !byId.has(n.parentId)) return n.parentId ? { ...n, parentId: null } : n;
    const seen = new Set<string>([n.id]);
    let cur: string | null = n.parentId;
    while (cur) {
      if (seen.has(cur)) return { ...n, parentId: null };
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    return n;
  });
}

export function catalogChildren(nodes: readonly CatalogNode[], parentId: string | null): CatalogNode[] {
  return nodes
    .filter((n) => n.parentId === parentId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function catalogAncestors(nodes: readonly CatalogNode[], nodeId: string): CatalogNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: CatalogNode[] = [];
  const seen = new Set<string>();
  let cur = byId.get(nodeId)?.parentId ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = byId.get(cur);
    if (!n) break;
    chain.unshift(n);
    cur = n.parentId;
  }
  return chain;
}

export function catalogDescendantIds(nodes: readonly CatalogNode[], rootId: string): string[] {
  const childrenByParent = new Map<string | null, CatalogNode[]>();
  for (const n of nodes) {
    const list = childrenByParent.get(n.parentId) ?? [];
    list.push(n);
    childrenByParent.set(n.parentId, list);
  }
  const out: string[] = [];
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n.id);
    const kids = childrenByParent.get(n.id);
    if (kids) stack.push(...kids);
  }
  return out;
}

export type PlanCreateCatalogNodeErr = {
  ok: false;
  errorKey: "shelfRenameEmpty" | "shelfRenameReserved" | "shelfRenameExists" | "catalogParentMissing";
};

export type PlanCreateCatalogNodeOk = {
  ok: true;
  node: CatalogNode;
  nodes: CatalogNode[];
};

export type PlanCreateCatalogNodeResult = PlanCreateCatalogNodeOk | PlanCreateCatalogNodeErr;

export type PlanCreateCatalogNodeInput = {
  name: string;
  parentId: string | null;
  nodes: readonly CatalogNode[];
  shopId: string;
  now?: string;
  id?: string;
};

export function planCreateCatalogNode(input: PlanCreateCatalogNodeInput): PlanCreateCatalogNodeResult {
  const name = normalizeShelfName(input.name);
  if (!name) return { ok: false, errorKey: "shelfRenameEmpty" };
  if (isReservedShelfKey(name)) return { ok: false, errorKey: "shelfRenameReserved" };

  const shopId = input.shopId.trim() || LOCAL_CATALOG_SHOP_ID;
  const scoped = catalogNodesForShop(input.nodes, shopId);
  if (input.parentId) {
    const parent = scoped.find((n) => n.id === input.parentId);
    if (!parent) return { ok: false, errorKey: "catalogParentMissing" };
  }

  const collision = scoped.find((n) => sameShelfKey(n.legacyShelfKey, name) || sameShelfKey(n.name, name));
  if (collision) return { ok: false, errorKey: "shelfRenameExists" };

  const siblings = catalogChildren(scoped, input.parentId);
  const sortOrder = siblings.reduce((max, n) => Math.max(max, n.sortOrder), -1) + 1;
  const now = input.now ?? new Date().toISOString();
  const node: CatalogNode = {
    id: input.id?.trim() || crypto.randomUUID(),
    shopId,
    parentId: input.parentId,
    legacyShelfKey: name,
    name,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, node, nodes: [...input.nodes, node] };
}

export type PlanCreateCatalogShelfOk = PlanCreateCatalogNodeOk & {
  layout: Record<string, PosShelfLayoutConfig>;
  orderKeys: string[];
};

export type PlanCreateCatalogShelfResult = PlanCreateCatalogShelfOk | PlanCreateCatalogNodeErr;

export function planCreateCatalogShelf(input: PlanCreateCatalogNodeInput & {
  layout: Record<string, PosShelfLayoutConfig>;
  orderKeys: readonly string[];
}): PlanCreateCatalogShelfResult {
  const planned = planCreateCatalogNode(input);
  if (!planned.ok) return planned;
  const key = planned.node.legacyShelfKey;
  const layout = fillDefaultShelfLayout({ ...input.layout }, [key], [...input.orderKeys]);
  const orderKeys = input.orderKeys.includes(key) ? [...input.orderKeys] : [...input.orderKeys, key];
  return { ...planned, layout, orderKeys };
}

/** Keep overlay identity in sync after a shelf rename. Does not rewrite products. */
export function remapCatalogNodesForRename(
  nodes: readonly CatalogNode[],
  fromKey: string,
  toKey: string,
): CatalogNode[] {
  const from = fromKey.trim();
  const to = normalizeShelfName(toKey);
  if (!from || !to || from === to) return nodes as CatalogNode[];
  const now = new Date().toISOString();
  let changed = false;
  const next = nodes.map((n) => {
    if (!sameShelfKey(n.legacyShelfKey, from) && !sameShelfKey(n.name, from)) return n;
    changed = true;
    return {
      ...n,
      legacyShelfKey: to,
      name: sameShelfKey(n.name, from) ? to : n.name,
      updatedAt: now,
    };
  });
  return changed ? next : (nodes as CatalogNode[]);
}

/** Remove leaf overlay nodes for a deleted empty shelf identity. Parents with children stay. */
export function retireCatalogNodesForDeletedShelf(
  nodes: readonly CatalogNode[],
  shelfKey: string,
): CatalogNode[] {
  const key = shelfKey.trim();
  if (!key) return [...nodes];
  const matching = nodes.filter((n) => sameShelfKey(n.legacyShelfKey, key) || sameShelfKey(n.name, key));
  const removeIds = new Set(
    matching.filter((n) => !nodes.some((c) => c.parentId === n.id)).map((n) => n.id),
  );
  if (removeIds.size === 0) return nodes as CatalogNode[];
  return nodes.filter((n) => !removeIds.has(n.id));
}

export function buildCatalogPickerItems(input: {
  products: readonly Product[];
  layout: Record<string, PosShelfLayoutConfig>;
  orderKeys: readonly string[];
  nodes: readonly CatalogNode[];
  shopId: string;
}): CatalogPickerItem[] {
  const scoped = catalogNodesForShop(input.nodes, input.shopId);
  const items: CatalogPickerItem[] = [];

  const walk = (parentId: string | null, depth: number, pathLabels: string[]) => {
    for (const n of catalogChildren(scoped, parentId)) {
      const labels = [...pathLabels, n.name];
      items.push({
        id: n.id,
        parentId: n.parentId,
        name: n.name,
        legacyShelfKey: n.legacyShelfKey,
        depth,
        pathLabels: labels,
        persisted: true,
        sortOrder: n.sortOrder,
      });
      walk(n.id, depth + 1, labels);
    }
  };
  walk(null, 0, []);

  const legacyKeys = collectShelfCategoryKeys(
    input.products as Product[],
    [...input.orderKeys],
    input.layout,
  );
  let virtualOrder = 0;
  for (const key of legacyKeys) {
    if (isReservedShelfKey(key)) continue;
    const already = scoped.some((n) => sameShelfKey(n.legacyShelfKey, key));
    if (already) continue;
    items.push({
      id: `${VIRTUAL_NODE_PREFIX}${key}`,
      parentId: null,
      name: input.layout[key]?.displayName?.trim() || key,
      legacyShelfKey: key,
      depth: 0,
      pathLabels: [input.layout[key]?.displayName?.trim() || key],
      persisted: false,
      sortOrder: 10_000 + virtualOrder,
    });
    virtualOrder += 1;
  }

  return items;
}

function normalizeSearchHay(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

export function catalogItemPathText(item: CatalogPickerItem): string {
  return item.pathLabels.join(" / ");
}

export function catalogItemMatchesQuery(item: CatalogPickerItem, query: string): boolean {
  const raw = query.trim();
  if (!raw) return true;
  const hay = normalizeSearchHay(
    `${item.name} ${item.legacyShelfKey} ${item.pathLabels.join(" ")} ${catalogItemPathText(item)}`,
  );
  const q = normalizeSearchHay(raw);
  if (hay.includes(q)) return true;
  const tokens = q.split(" ").filter(Boolean);
  return tokens.every((tok) => hay.includes(tok));
}

export function searchCatalogPickerItems(items: readonly CatalogPickerItem[], query: string): CatalogPickerItem[] {
  return items.filter((item) => catalogItemMatchesQuery(item, query));
}

export function assignmentCategoryFromPickerItem(item: CatalogPickerItem): string {
  return item.legacyShelfKey;
}

/** Match a picker row to Product.category / legacyShelfKey without treating path as identity. */
export function findCatalogPickerItemByIdentity(
  items: readonly CatalogPickerItem[],
  identity: string,
): CatalogPickerItem | undefined {
  const key = identity.trim();
  if (!key) return undefined;
  return items.find((i) => sameShelfKey(i.legacyShelfKey, key) || sameShelfKey(i.name, key));
}

/** Display-only path. Never write this string to Product.category. */
export function selectedCatalogDestinationPath(
  items: readonly CatalogPickerItem[],
  identity: string,
): string {
  const item = findCatalogPickerItemByIdentity(items, identity);
  return item ? catalogItemPathText(item) : "";
}

/**
 * After Create new shelf: keep the current destination unless create succeeded.
 * Failed create must not assign the typed name as Product.category.
 */
export function nextDestinationAfterCatalogCreate(input: {
  ok: boolean;
  legacyShelfKey?: string;
  currentValue: string;
}): { value: string; assigned: boolean } {
  if (!input.ok || !input.legacyShelfKey?.trim()) {
    return { value: input.currentValue, assigned: false };
  }
  return { value: input.legacyShelfKey.trim(), assigned: true };
}

export type HierarchyPickerChrome = {
  showSearch: boolean;
  showCreate: boolean;
  mode: "flat" | "hierarchy";
};

export function hierarchyPickerChrome(enabled: boolean, canCreate = true): HierarchyPickerChrome {
  if (enabled !== true) return { showSearch: false, showCreate: false, mode: "flat" };
  return { showSearch: true, showCreate: canCreate === true, mode: "hierarchy" };
}

export function applySharedCategoryToRows<T extends { category: string }>(
  rows: readonly T[],
  category: string,
  selected?: ReadonlySet<number>,
): T[] {
  const next = category.trim();
  if (!next) return [...rows];
  return rows.map((row, i) => {
    if (selected && !selected.has(i)) return row;
    return { ...row, category: next };
  });
}

export function settingsCatalogFoldersVisible(enabled: boolean): boolean {
  return enabled === true;
}

export type CatalogFolderTreeRow = {
  id: string;
  parentId: string | null;
  name: string;
  legacyShelfKey: string;
  depth: number;
  pathLabels: string[];
  pathText: string;
  hasChildren: boolean;
  childCount: number;
  directProductCount: number;
  inclusiveProductCount: number;
  sortOrder: number;
};

function identityProductCount(products: readonly Product[], identity: string): number {
  return products.reduce((n, p) => {
    const cat = (p.category ?? "").trim();
    return cat && sameShelfKey(cat, identity) ? n + 1 : n;
  }, 0);
}

export function buildCatalogFolderTreeRows(input: {
  nodes: readonly CatalogNode[];
  shopId: string;
  products?: readonly Product[];
}): CatalogFolderTreeRow[] {
  const scoped = catalogNodesForShop(input.nodes, input.shopId);
  const products = input.products ?? [];
  const rows: CatalogFolderTreeRow[] = [];
  const walk = (parentId: string | null, depth: number, pathLabels: string[]) => {
    for (const n of catalogChildren(scoped, parentId)) {
      const labels = [...pathLabels, n.name];
      const kids = catalogChildren(scoped, n.id);
      const descendantIds = catalogDescendantIds(scoped, n.id);
      const descendantKeys = descendantIds
        .map((id) => scoped.find((x) => x.id === id)?.legacyShelfKey)
        .filter(Boolean) as string[];
      const directProductCount = identityProductCount(products, n.legacyShelfKey);
      const inclusiveProductCount =
        directProductCount +
        descendantKeys.reduce((sum, key) => sum + identityProductCount(products, key), 0);
      rows.push({
        id: n.id,
        parentId: n.parentId,
        name: n.name,
        legacyShelfKey: n.legacyShelfKey,
        depth,
        pathLabels: labels,
        pathText: labels.join(" / "),
        hasChildren: kids.length > 0,
        childCount: kids.length,
        directProductCount,
        inclusiveProductCount,
        sortOrder: n.sortOrder,
      });
      walk(n.id, depth + 1, labels);
    }
  };
  walk(null, 0, []);
  return rows;
}

export function visibleCatalogFolderTreeRows(
  rows: readonly CatalogFolderTreeRow[],
  expandedIds: ReadonlySet<string>,
  query: string,
): CatalogFolderTreeRow[] {
  const q = query.trim();
  if (q) {
    const keep = new Set<string>();
    for (const row of rows) {
      const item: CatalogPickerItem = {
        id: row.id,
        parentId: row.parentId,
        name: row.name,
        legacyShelfKey: row.legacyShelfKey,
        depth: row.depth,
        pathLabels: row.pathLabels,
        persisted: true,
        sortOrder: row.sortOrder,
      };
      if (!catalogItemMatchesQuery(item, q)) continue;
      keep.add(row.id);
      let parentId = row.parentId;
      while (parentId) {
        keep.add(parentId);
        parentId = rows.find((r) => r.id === parentId)?.parentId ?? null;
      }
    }
    return rows.filter((r) => keep.has(r.id));
  }

  const hidden = new Set<string>();
  for (const row of rows) {
    if (row.parentId && (hidden.has(row.parentId) || !expandedIds.has(row.parentId))) {
      hidden.add(row.id);
    }
  }
  return rows.filter((r) => !hidden.has(r.id));
}

export function catalogReparentTargets(
  nodes: readonly CatalogNode[],
  shopId: string,
  nodeId: string,
): CatalogNode[] {
  const scoped = catalogNodesForShop(nodes, shopId);
  const blocked = new Set([nodeId, ...catalogDescendantIds(scoped, nodeId)]);
  return scoped.filter((n) => !blocked.has(n.id));
}

export type PlanReparentCatalogNodeErr = {
  ok: false;
  errorKey: "catalogNodeMissing" | "catalogParentMissing" | "catalogReparentCycle";
};

export type PlanReparentCatalogNodeOk = {
  ok: true;
  nodes: CatalogNode[];
  nodeId: string;
  parentId: string | null;
};

export function planReparentCatalogNode(input: {
  nodeId: string;
  parentId: string | null;
  nodes: readonly CatalogNode[];
  shopId: string;
  now?: string;
}): PlanReparentCatalogNodeOk | PlanReparentCatalogNodeErr {
  const shopId = input.shopId.trim() || LOCAL_CATALOG_SHOP_ID;
  const scoped = catalogNodesForShop(input.nodes, shopId);
  const node = scoped.find((n) => n.id === input.nodeId);
  if (!node) return { ok: false, errorKey: "catalogNodeMissing" };
  const parentId = input.parentId?.trim() || null;
  if (parentId === node.id) return { ok: false, errorKey: "catalogReparentCycle" };
  if (parentId) {
    const parent = scoped.find((n) => n.id === parentId);
    if (!parent) return { ok: false, errorKey: "catalogParentMissing" };
    if (catalogDescendantIds(scoped, node.id).includes(parentId)) {
      return { ok: false, errorKey: "catalogReparentCycle" };
    }
  }
  if (node.parentId === parentId) {
    return { ok: true, nodes: input.nodes as CatalogNode[], nodeId: node.id, parentId };
  }
  const siblings = catalogChildren(scoped, parentId).filter((n) => n.id !== node.id);
  const sortOrder = siblings.reduce((max, n) => Math.max(max, n.sortOrder), -1) + 1;
  const now = input.now ?? new Date().toISOString();
  const next = input.nodes.map((n) =>
    n.id === node.id ? { ...n, parentId, sortOrder, updatedAt: now } : n,
  );
  return { ok: true, nodes: next, nodeId: node.id, parentId };
}

export type PlanReorderCatalogSiblingsErr = {
  ok: false;
  errorKey: "catalogReorderInvalid";
};

export type PlanReorderCatalogSiblingsOk = {
  ok: true;
  nodes: CatalogNode[];
};

export function planReorderCatalogSiblings(input: {
  parentId: string | null;
  orderedIds: readonly string[];
  nodes: readonly CatalogNode[];
  shopId: string;
  now?: string;
}): PlanReorderCatalogSiblingsOk | PlanReorderCatalogSiblingsErr {
  const shopId = input.shopId.trim() || LOCAL_CATALOG_SHOP_ID;
  const scoped = catalogNodesForShop(input.nodes, shopId);
  const siblings = catalogChildren(scoped, input.parentId);
  if (siblings.length !== input.orderedIds.length) return { ok: false, errorKey: "catalogReorderInvalid" };
  const current = new Set(siblings.map((n) => n.id));
  const nextIds = [...input.orderedIds];
  if (nextIds.some((id) => !current.has(id)) || new Set(nextIds).size !== nextIds.length) {
    return { ok: false, errorKey: "catalogReorderInvalid" };
  }
  const now = input.now ?? new Date().toISOString();
  const order = new Map(nextIds.map((id, i) => [id, i]));
  const next = input.nodes.map((n) => {
    const sortOrder = order.get(n.id);
    if (sortOrder == null) return n;
    return { ...n, sortOrder, updatedAt: now };
  });
  return { ok: true, nodes: next };
}
