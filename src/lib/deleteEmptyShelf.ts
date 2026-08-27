import type { PosShelfLayoutConfig, Product } from "../types";
import { UNCATEGORIZED_SENTINEL } from "./productCategories";
import { QUICK_SELL_SHELF_KEY } from "./posShelfLayout";

export type PlanDeleteEmptyShelfInput = {
  shelfKey: string;
  products: readonly Product[];
  layout: Record<string, PosShelfLayoutConfig>;
  orderKeys: readonly string[];
  sellCategoryFilter?: string | null;
};

export type PlanDeleteEmptyShelfOk = {
  ok: true;
  shelfKey: string;
  layout: Record<string, PosShelfLayoutConfig>;
  orderKeys: string[];
  clearSellCategoryFilter: boolean;
};

export type PlanDeleteEmptyShelfErr = {
  ok: false;
  errorKey: "shelfDeleteEmpty" | "shelfDeleteReserved" | "shelfDeleteNotEmpty";
};

export type PlanDeleteEmptyShelfResult = PlanDeleteEmptyShelfOk | PlanDeleteEmptyShelfErr;

function sameShelfKey(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

function isReservedShelfKey(key: string): boolean {
  return key === QUICK_SELL_SHELF_KEY || key === UNCATEGORIZED_SENTINEL;
}

function isRetiredShelfKey(key: string, shelfKey: string): boolean {
  const trimmed = key.trim();
  return Boolean(trimmed) && sameShelfKey(trimmed, shelfKey);
}

/**
 * Preference-only plan to remove an empty shelf identity (layout + order).
 * Never mutates products. Rejects reserved keys and any product still using
 * this shelf identity (including case variants).
 */
export function planDeleteEmptyShelf(input: PlanDeleteEmptyShelfInput): PlanDeleteEmptyShelfResult {
  const shelfKey = input.shelfKey.trim();
  if (!shelfKey) return { ok: false, errorKey: "shelfDeleteEmpty" };
  if (isReservedShelfKey(shelfKey)) return { ok: false, errorKey: "shelfDeleteReserved" };

  const blocking = input.products.some((p) => {
    const cat = (p.category ?? "").trim();
    return Boolean(cat) && sameShelfKey(cat, shelfKey);
  });
  if (blocking) return { ok: false, errorKey: "shelfDeleteNotEmpty" };

  const layout: Record<string, PosShelfLayoutConfig> = {};
  for (const [key, value] of Object.entries(input.layout)) {
    if (isRetiredShelfKey(key, shelfKey)) continue;
    layout[key] = value;
  }

  const orderKeys: string[] = [];
  const seen = new Set<string>();
  for (const key of input.orderKeys) {
    if (isRetiredShelfKey(key, shelfKey)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    orderKeys.push(key);
  }

  const filter = input.sellCategoryFilter?.trim() ?? "";
  const clearSellCategoryFilter = Boolean(filter) && isRetiredShelfKey(filter, shelfKey);

  return {
    ok: true,
    shelfKey,
    layout,
    orderKeys,
    clearSellCategoryFilter,
  };
}
