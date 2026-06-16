import {
  UNCATEGORIZED_SENTINEL,
  distinctTrimmedCategories,
  shelfIconFor,
} from "./productCategories";
import type { Product } from "../types";

export type PosShelfCard = {
  key: string;
  label: string;
  count: number;
  icon: string | null;
};

export function buildPosShelfCards(
  products: Product[],
  noShelfLabel: string,
): PosShelfCard[] {
  const categoryOptions = distinctTrimmedCategories(products);
  const hasUncategorized = products.some((p) => !(p.category ?? "").trim());
  const categoryCounts = new Map<string, number>();
  let uncategorizedCount = 0;
  for (const p of products) {
    const cat = (p.category ?? "").trim();
    if (!cat) {
      uncategorizedCount += 1;
    } else {
      categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
    }
  }
  const cards = categoryOptions.map((cat) => ({
    key: cat,
    label: cat,
    count: categoryCounts.get(cat) ?? 0,
    icon: shelfIconFor(cat),
  }));
  if (hasUncategorized) {
    cards.push({
      key: UNCATEGORIZED_SENTINEL,
      label: noShelfLabel,
      count: uncategorizedCount,
      icon: null,
    });
  }
  return cards;
}

/** Reorder shelf keys by moving one key before another (drag-and-drop). */
export function reorderShelfKeys(orderKeys: string[], activeKey: string, overKey: string): string[] {
  if (activeKey === overKey) return orderKeys;
  const from = orderKeys.indexOf(activeKey);
  const to = orderKeys.indexOf(overKey);
  if (from < 0 || to < 0) return orderKeys;
  const next = [...orderKeys];
  next.splice(from, 1);
  next.splice(to, 0, activeKey);
  return next;
}

/** Shop-wide shelf order (set in stock/back office), then alphabetical for any new shelves. */
export function effectiveShelfOrderKeys(allKeys: string[], savedOrder: string[]): string[] {
  const ordered = savedOrder.filter((key) => allKeys.includes(key));
  const rest = allKeys
    .filter((key) => !ordered.includes(key))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return [...ordered, ...rest];
}

export function sortPosShelfCards(cards: PosShelfCard[], orderKeys: string[]): PosShelfCard[] {
  const allKeys = cards.map((c) => c.key);
  const rank = new Map(effectiveShelfOrderKeys(allKeys, orderKeys).map((key, index) => [key, index]));
  return [...cards].sort((a, b) => {
    const aRank = rank.get(a.key) ?? Number.POSITIVE_INFINITY;
    const bRank = rank.get(b.key) ?? Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}

export function togglePinnedShelfKey(pinnedKeys: string[], key: string, max = 40): string[] {
  if (pinnedKeys.includes(key)) return pinnedKeys.filter((k) => k !== key);
  return [...pinnedKeys, key].slice(0, max);
}

export function movePinnedShelfKey(pinnedKeys: string[], key: string, direction: "up" | "down"): string[] {
  const index = pinnedKeys.indexOf(key);
  if (index < 0) return pinnedKeys;
  const swap = direction === "up" ? index - 1 : index + 1;
  if (swap < 0 || swap >= pinnedKeys.length) return pinnedKeys;
  const next = [...pinnedKeys];
  [next[index], next[swap]] = [next[swap]!, next[index]!];
  return next;
}
