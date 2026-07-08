import { useCallback, useMemo, useState } from "react";
import type { Language, Product, ShopPreferences } from "../types";
import {
  CATEGORY_FILTER_ALL,
  productMatchesCategoryFilter,
  productMatchesSellSearch,
  UNCATEGORIZED_SENTINEL,
} from "../lib/productCategories";
import { buildPosShelfDisplayCards } from "../lib/posShelfLayout";
import { posSearchAliases } from "../lib/pharmacyUx";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";

const EMPTY_SHELF_LAYOUT: Record<string, never> = {};
const EMPTY_SHELF_ORDER: string[] = [];
const MAX_RECENT_SEARCHES = 4;

export type SellProductBrowseEngineOptions = {
  lang: Language;
  products: Product[];
  preferences: ShopPreferences;
  /** When set, category filter is local (not persisted to preferences). */
  ephemeralCategory?: boolean;
  initialCategoryKey?: string;
};

export function useSellProductBrowseEngine({
  lang,
  products,
  preferences,
  ephemeralCategory = false,
  initialCategoryKey = CATEGORY_FILTER_ALL,
}: SellProductBrowseEngineOptions) {
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [searchQuery, setSearchQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [localCategoryKey, setLocalCategoryKey] = useState(initialCategoryKey);

  const sellCategoryKey = ephemeralCategory
    ? localCategoryKey
    : preferences.posSellCategoryFilter ?? CATEGORY_FILTER_ALL;

  const shelfOrderKeys = preferences.posPinnedShelfKeys ?? EMPTY_SHELF_ORDER;
  const shelfLayout = preferences.posShelfLayout ?? EMPTY_SHELF_LAYOUT;
  const shelfDefaultScale = preferences.posShelfDefaultScale ?? 35;
  const favoriteIdSet = useMemo(() => new Set(preferences.favoriteProductIds ?? []), [preferences.favoriteProductIds]);

  const setSellCategoryFilter = useCallback(
    (next: string) => {
      const normalized =
        next === CATEGORY_FILTER_ALL || next === ""
          ? CATEGORY_FILTER_ALL
          : next === UNCATEGORIZED_SENTINEL
            ? UNCATEGORIZED_SENTINEL
            : next;
      if (ephemeralCategory) {
        setLocalCategoryKey(normalized);
        return;
      }
      setPreferences({
        posSellCategoryFilter:
          normalized === CATEGORY_FILTER_ALL ? undefined : normalized === UNCATEGORIZED_SENTINEL ? UNCATEGORIZED_SENTINEL : normalized,
      });
    },
    [ephemeralCategory, setPreferences],
  );

  const clearSellView = useCallback(() => {
    setSellCategoryFilter(CATEGORY_FILTER_ALL);
    setSearchQuery("");
  }, [setSellCategoryFilter]);

  const sellSearchContext = useMemo(() => {
    const q = searchQuery.trim();
    const qLower = q.toLowerCase();
    const aliases = posSearchAliases(
      preferences.businessType,
      preferences.pharmacyModeEnabled,
      preferences.hospitalityModeEnabled,
    );
    const aliasSet = new Set<string>();
    if (qLower && aliases[qLower]) {
      for (const a of aliases[qLower]) aliasSet.add(a);
    }
    for (const tok of qLower.split(/\s+/).filter(Boolean)) {
      const al = aliases[tok];
      if (al) for (const x of al) aliasSet.add(x);
    }
    return { q, aliasTerms: [...aliasSet] };
  }, [searchQuery, preferences.businessType, preferences.pharmacyModeEnabled, preferences.hospitalityModeEnabled]);

  const filteredProducts = useMemo(() => {
    const { q, aliasTerms } = sellSearchContext;
    return products
      .filter((p) => {
        if (!q) return productMatchesCategoryFilter(p, sellCategoryKey);
        return productMatchesSellSearch(p, q, aliasTerms);
      })
      .sort((a, b) => {
        const favA = favoriteIdSet.has(a.id) ? 0 : 1;
        const favB = favoriteIdSet.has(b.id) ? 0 : 1;
        if (favA !== favB) return favA - favB;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
  }, [products, sellSearchContext, sellCategoryKey, favoriteIdSet]);

  const shelfCards = useMemo(
    () => buildPosShelfDisplayCards(products, t(lang, "posNoShelf"), shelfLayout, shelfOrderKeys, shelfDefaultScale),
    [products, lang, shelfLayout, shelfOrderKeys, shelfDefaultScale],
  );

  const hasSellViewFilter = sellCategoryKey !== CATEGORY_FILTER_ALL || sellSearchContext.q.length > 0;
  const showCatalogShelfGrid = sellCategoryKey === CATEGORY_FILTER_ALL && sellSearchContext.q.length === 0;
  const catalogShelfDrillDown = sellCategoryKey !== CATEGORY_FILTER_ALL && sellSearchContext.q.length === 0;

  const selectedShelfLabel =
    sellCategoryKey === UNCATEGORIZED_SENTINEL
      ? t(lang, "uncategorized")
      : sellCategoryKey === CATEGORY_FILTER_ALL
        ? t(lang, "posAllProducts")
        : sellCategoryKey;

  const commitSearch = useCallback((raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setRecentSearches((prev) => [q, ...prev.filter((x) => x !== q)].slice(0, MAX_RECENT_SEARCHES));
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    recentSearches,
    commitSearch,
    sellCategoryKey,
    setSellCategoryFilter,
    clearSellView,
    filteredProducts,
    shelfCards,
    sellSearchContext,
    hasSellViewFilter,
    showCatalogShelfGrid,
    catalogShelfDrillDown,
    selectedShelfLabel,
  };
}
