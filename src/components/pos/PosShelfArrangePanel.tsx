import { useCallback, useMemo, useState } from "react";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import {
  buildPosShelfCards,
  effectiveShelfOrderKeys,
  reorderShelfKeys,
  sortPosShelfCards,
} from "../../lib/posShelfOrder";
import { PosShelfTile } from "./PosShelfTile";

type Props = {
  lang: Language;
  products: Product[];
  /** When true, omit outer article chrome (embedded in settings page). */
  embedded?: boolean;
};

export function PosShelfArrangePanel({ lang, products, embedded = false }: Props) {
  const savedOrder = usePosStore((s) => s.preferences.posPinnedShelfKeys ?? []);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const shelfCards = useMemo(() => {
    const cards = buildPosShelfCards(products, t(lang, "posNoShelf"));
    return sortPosShelfCards(cards, savedOrder);
  }, [products, lang, savedOrder]);

  const orderKeys = useMemo(
    () => effectiveShelfOrderKeys(shelfCards.map((c) => c.key), savedOrder),
    [shelfCards, savedOrder],
  );

  const applyReorder = useCallback(
    (activeKey: string, targetKey: string) => {
      const next = reorderShelfKeys(orderKeys, activeKey, targetKey);
      if (next !== orderKeys) setPreferences({ posPinnedShelfKeys: next });
    },
    [orderKeys, setPreferences],
  );

  const endDrag = useCallback(() => {
    setDragKey(null);
    setOverKey(null);
  }, []);

  const startDrag = useCallback((key: string, e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragKey(key);
    setOverKey(key);
  }, []);

  const handleEnter = useCallback(
    (key: string) => {
      if (!dragKey || dragKey === key) return;
      setOverKey(key);
      applyReorder(dragKey, key);
    },
    [dragKey, applyReorder],
  );

  if (shelfCards.length === 0) return null;

  const grid = (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {shelfCards.map((shelf) => (
        <PosShelfTile
          key={shelf.key}
          shelf={shelf}
          mode="arrange"
          dragging={dragKey === shelf.key}
          dragOver={overKey === shelf.key && dragKey !== shelf.key}
          countLabel={t(lang, "posShelfProductCount").replace("{{count}}", String(shelf.count))}
          onDragPointerDown={(e) => startDrag(shelf.key, e)}
          onDragPointerEnter={() => handleEnter(shelf.key)}
          onDragPointerUp={endDrag}
        />
      ))}
    </div>
  );

  if (embedded) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-stone-600">{t(lang, "stockShelfArrangeSub")}</p>
        {grid}
      </div>
    );
  }

  return (
    <article className="space-y-3 rounded-2xl border-2 border-waka-200 bg-waka-50/60 p-4">
      <div>
        <p className="text-base font-black text-stone-950">{t(lang, "stockShelfArrangeTitle")}</p>
        <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "stockShelfArrangeSub")}</p>
      </div>
      {grid}
    </article>
  );
}
