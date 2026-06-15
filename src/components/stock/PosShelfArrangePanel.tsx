import { useCallback, useMemo } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import {
  UNCATEGORIZED_SENTINEL,
  distinctTrimmedCategories,
  shelfIconFor,
} from "../../lib/productCategories";
import {
  effectiveShelfOrderKeys,
  movePinnedShelfKey,
  sortPosShelfCards,
  type PosShelfCard,
} from "../../lib/posShelfOrder";

type Props = {
  lang: Language;
  products: Product[];
};

function buildShelfCards(
  products: Product[],
  categoryOptions: string[],
  hasUncategorized: boolean,
  noShelfLabel: string,
): PosShelfCard[] {
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

export function PosShelfArrangePanel({ lang, products }: Props) {
  const savedOrder = usePosStore((s) => s.preferences.posPinnedShelfKeys ?? []);
  const setPreferences = usePosStore((s) => s.setPreferences);

  const categoryOptions = useMemo(() => distinctTrimmedCategories(products), [products]);
  const hasUncategorized = useMemo(() => products.some((p) => !(p.category ?? "").trim()), [products]);

  const shelfCards = useMemo(() => {
    const cards = buildShelfCards(products, categoryOptions, hasUncategorized, t(lang, "posNoShelf"));
    return sortPosShelfCards(cards, savedOrder);
  }, [products, categoryOptions, hasUncategorized, lang, savedOrder]);

  const orderKeys = useMemo(
    () => effectiveShelfOrderKeys(shelfCards.map((c) => c.key), savedOrder),
    [shelfCards, savedOrder],
  );

  const moveShelf = useCallback(
    (key: string, direction: "up" | "down") => {
      const next = movePinnedShelfKey(orderKeys, key, direction);
      setPreferences({ posPinnedShelfKeys: next });
    },
    [orderKeys, setPreferences],
  );

  if (shelfCards.length === 0) return null;

  return (
    <article className="space-y-3 rounded-2xl border-2 border-waka-200 bg-waka-50/60 p-4">
      <div>
        <p className="text-base font-black text-stone-950">{t(lang, "stockShelfArrangeTitle")}</p>
        <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "stockShelfArrangeSub")}</p>
      </div>
      <ul className="space-y-2">
        {shelfCards.map((shelf) => {
          const index = orderKeys.indexOf(shelf.key);
          return (
            <li
              key={shelf.key}
              className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white p-3 shadow-sm"
            >
              <span className="text-2xl" aria-hidden>
                {shelf.icon ?? "▣"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-black text-stone-950">{shelf.label}</span>
                <span className="text-xs font-semibold text-stone-500">
                  {tTemplate(lang, "stockShelfProductCount", { count: String(shelf.count) })}
                </span>
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={index <= 0}
                  onClick={() => moveShelf(shelf.key, "up")}
                  aria-label={t(lang, "posMoveShelfUp")}
                  className={clsx(
                    "flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 shadow-sm disabled:opacity-30",
                  )}
                >
                  <ChevronUp className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={index < 0 || index >= orderKeys.length - 1}
                  onClick={() => moveShelf(shelf.key, "down")}
                  aria-label={t(lang, "posMoveShelfDown")}
                  className={clsx(
                    "flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 shadow-sm disabled:opacity-30",
                  )}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
