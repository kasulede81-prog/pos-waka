import type { PosShelfLayoutConfig, Product } from "../types";
import { UNCATEGORIZED_SENTINEL } from "./productCategories";
import { QUICK_SELL_SHELF_KEY } from "./posShelfLayout";

export const SHELF_NAME_MAX_LEN = 80;

export type PlanShelfRenameInput = {
  fromKey: string;
  toName: string;
  products: readonly Product[];
  layout: Record<string, PosShelfLayoutConfig>;
  orderKeys: readonly string[];
  sellCategoryFilter?: string | null;
};

export type PlanShelfRenameOk = {
  ok: true;
  fromKey: string;
  toKey: string;
  unchanged: boolean;
  productIds: string[];
  layout: Record<string, PosShelfLayoutConfig>;
  orderKeys: string[];
  sellCategoryFilter?: string;
};

export type PlanShelfRenameErr = {
  ok: false;
  errorKey:
    | "shelfRenameEmpty"
    | "shelfRenameReserved"
    | "shelfRenameExists"
    | "shelfRenameUncategorized";
};

export type PlanShelfRenameResult = PlanShelfRenameOk | PlanShelfRenameErr;

export function normalizeShelfName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, SHELF_NAME_MAX_LEN);
}

function sameShelfKey(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

function isReservedShelfKey(key: string): boolean {
  return key === QUICK_SELL_SHELF_KEY || key === UNCATEGORIZED_SENTINEL;
}

/** Collect every known shelf identity (product categories + layout + order). */
export function knownShelfKeys(
  products: readonly Product[],
  layout: Record<string, PosShelfLayoutConfig>,
  orderKeys: readonly string[],
): string[] {
  const keys = new Set<string>();
  for (const p of products) {
    const c = (p.category ?? "").trim();
    if (c) keys.add(c);
  }
  for (const k of Object.keys(layout)) {
    const t = k.trim();
    if (t) keys.add(t);
  }
  for (const k of orderKeys) {
    const t = k.trim();
    if (t) keys.add(t);
  }
  return [...keys];
}

/**
 * Rename a product shelf/category. Updates product.category and migrates
 * Sell-screen layout/order keys. Does not merge into an existing different shelf.
 */
export function planShelfRename(input: PlanShelfRenameInput): PlanShelfRenameResult {
  const fromKey = input.fromKey.trim();
  const toKey = normalizeShelfName(input.toName);

  if (!fromKey || isReservedShelfKey(fromKey)) {
    return { ok: false, errorKey: "shelfRenameUncategorized" };
  }
  if (!toKey) return { ok: false, errorKey: "shelfRenameEmpty" };
  if (isReservedShelfKey(toKey)) return { ok: false, errorKey: "shelfRenameReserved" };

  const known = knownShelfKeys(input.products, input.layout, input.orderKeys);
  const collision = known.find((k) => sameShelfKey(k, toKey) && !sameShelfKey(k, fromKey));
  if (collision) return { ok: false, errorKey: "shelfRenameExists" };

  const productIds = input.products
    .filter((p) => (p.category ?? "").trim() === fromKey)
    .map((p) => p.id);

  if (fromKey === toKey) {
    const layout = { ...input.layout };
    const prev = layout[fromKey] ?? {};
    layout[fromKey] = { ...prev, displayName: toKey };
    return {
      ok: true,
      fromKey,
      toKey,
      unchanged: true,
      productIds: [],
      layout,
      orderKeys: [...input.orderKeys],
    };
  }

  const isRetiredShelfKey = (key: string) => {
    const trimmed = key.trim();
    return Boolean(trimmed) && sameShelfKey(trimmed, fromKey) && trimmed !== toKey;
  };

  const layout: Record<string, PosShelfLayoutConfig> = {};
  const retiredLayout: PosShelfLayoutConfig[] = [];
  for (const [key, value] of Object.entries(input.layout)) {
    if (isRetiredShelfKey(key)) {
      retiredLayout.push(value);
      continue;
    }
    layout[key] = value;
  }
  const prev = input.layout[fromKey] ?? retiredLayout[0] ?? layout[toKey] ?? {};
  layout[toKey] = { ...prev, displayName: toKey };

  const seen = new Set<string>();
  const orderKeys: string[] = [];
  for (const key of input.orderKeys) {
    const next = isRetiredShelfKey(key) ? toKey : key;
    if (seen.has(next)) continue;
    seen.add(next);
    orderKeys.push(next);
  }
  if (!seen.has(toKey)) orderKeys.push(toKey);

  const sellCategoryFilter =
    input.sellCategoryFilter != null && isRetiredShelfKey(input.sellCategoryFilter)
      ? toKey
      : input.sellCategoryFilter ?? undefined;

  return {
    ok: true,
    fromKey,
    toKey,
    unchanged: false,
    productIds,
    layout,
    orderKeys,
    ...(sellCategoryFilter !== undefined ? { sellCategoryFilter } : {}),
  };
}
