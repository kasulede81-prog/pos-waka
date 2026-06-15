export type PosShelfCard = {
  key: string;
  label: string;
  count: number;
  icon: string | null;
};

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
