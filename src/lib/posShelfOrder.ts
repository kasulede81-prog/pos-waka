import { UNCATEGORIZED_SENTINEL } from "./productCategories";

export type PosShelfCard = {
  key: string;
  label: string;
  count: number;
  icon: string | null;
};

/** Pinned shelves first (user order), then by today's sales, then name. */
export function sortPosShelfCards(
  cards: PosShelfCard[],
  pinnedKeys: string[],
  soldTodayByCategory: Map<string, number>,
): PosShelfCard[] {
  const pinRank = new Map(pinnedKeys.map((key, index) => [key, index]));
  return [...cards].sort((a, b) => {
    const aPinned = pinRank.get(a.key);
    const bPinned = pinRank.get(b.key);
    const aRank = aPinned ?? Number.POSITIVE_INFINITY;
    const bRank = bPinned ?? Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    const aSold = soldTodayByCategory.get(a.key) ?? 0;
    const bSold = soldTodayByCategory.get(b.key) ?? 0;
    if (aSold !== bSold) return bSold - aSold;
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

export function soldTodayUnitsByCategory(
  products: { id: string; category?: string | null }[],
  soldTodayByProduct: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of products) {
    const qty = soldTodayByProduct.get(p.id) ?? 0;
    if (qty <= 0) continue;
    const key = (p.category ?? "").trim() || UNCATEGORIZED_SENTINEL;
    out.set(key, (out.get(key) ?? 0) + qty);
  }
  return out;
}
