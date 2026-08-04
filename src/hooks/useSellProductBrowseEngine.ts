import { useCallback, useMemo, useState } from "react";
import type { Language, Product, ShopPreferences } from "../types";
import {
  CATEGORY_FILTER_ALL,
  UNCATEGORIZED_SENTINEL,
} from "../lib/productCategories";
import { buildPosShelfDisplayCards } from "../lib/posShelfLayout";
import { posSearchAliases } from "../lib/pharmacyUx";
import {
  buildProductSellSearchIndex,
  filterIndexedProductsForSellView,
  filterProductsByCategoryOnly,
  productMatchesIndexedSellSearch,
} from "../lib/posProductSearch";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";

const EMPTY_SHELF_LAYOUT: Record<string, never> = {};
const EMPTY_SHELF_ORDER: string[] = [];
const MAX_RECENT_SEARCHES = 4;

export type SellProductBrowseEngineOptions = {
  lang: Language;
  products: Product[];
  preferences: ShopPreferences;
  /**
   * When true, category filter is local only.
   * Phase 32.3 default: false — Retail + Pharmacy share persisted preference.
   */
  ephemeralCategory?: boolean;
  initialCategoryKey?: string;
  /** Controlled search — when set, engine does not own search state. */
  searchQuery?: string;
  setSearchQuery?: (next: string) => void;
};

/**
 * Shared Sell shelf/product browse engine (Phase 32.3).
 * Retail PosPage and Pharmacy dispense share this runtime; business rules stay outside.
 */
export function useSellProductBrowseEngine({
  lang,
  products,
  preferences,
  ephemeralCategory = false,
  initialCategoryKey = CATEGORY_FILTER_ALL,
  searchQuery: controlledSearchQuery,
  setSearchQuery: controlledSetSearchQuery,
}: SellProductBrowseEngineOptions) {
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [localCategoryKey, setLocalCategoryKey] = useState(initialCategoryKey);

  const searchControlled = typeof controlledSetSearchQuery === "function";
  const searchQuery = searchControlled ? (controlledSearchQuery ?? "") : internalSearchQuery;
  const setSearchQuery = searchControlled ? controlledSetSearchQuery! : setInternalSearchQuery;

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
          normalized === CATEGORY_FILTER_ALL
            ? undefined
            : normalized === UNCATEGORIZED_SENTINEL
              ? UNCATEGORIZED_SENTINEL
              : normalized,
      });
    },
    [ephemeralCategory, setPreferences],
  );

  const clearSellView = useCallback(() => {
    setSellCategoryFilter(CATEGORY_FILTER_ALL);
    setSearchQuery("");
  }, [setSellCategoryFilter, setSearchQuery]);

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

  const productSearchIndex = useMemo(() => buildProductSellSearchIndex(products), [products]);

  const sellRowMatchesSearch = useMemo(() => {
    const { q, aliasTerms } = sellSearchContext;
    if (!q) return () => true;
    return (p: Product) => productMatchesIndexedSellSearch(productSearchIndex, p, q, aliasTerms);
  }, [sellSearchContext, productSearchIndex]);

  const filteredProducts = useMemo(() => {
    const { q, aliasTerms } = sellSearchContext;
    if (!q) {
      return filterProductsByCategoryOnly(products, sellCategoryKey, favoriteIdSet);
    }
    return filterIndexedProductsForSellView(productSearchIndex, sellCategoryKey, q, aliasTerms, favoriteIdSet);
  }, [products, productSearchIndex, sellSearchContext, sellCategoryKey, favoriteIdSet]);

  const shelfCards = useMemo(
    () => buildPosShelfDisplayCards(products, t(lang, "posNoShelf"), shelfLayout, shelfOrderKeys, shelfDefaultScale),
    [products, lang, shelfLayout, shelfOrderKeys, shelfDefaultScale],
  );

  const hasSellViewFilter = sellCategoryKey !== CATEGORY_FILTER_ALL || sellSearchContext.q.length > 0;
  const showCatalogShelfGrid = sellCategoryKey === CATEGORY_FILTER_ALL && sellSearchContext.q.length === 0;
  const catalogShelfDrillDown = sellCategoryKey !== CATEGORY_FILTER_ALL && sellSearchContext.q.length === 0;

  const selectedShelfLabel =
    sellCategoryKey === UNCATEGORIZED_SENTINEL
      ? t(lang, "posNoShelf")
      : sellCategoryKey === CATEGORY_FILTER_ALL
        ? t(lang, "posCategoryAll")
        : sellCategoryKey;

  const commitSearch = useCallback(
    (raw: string) => {
      const q = raw.trim();
      if (!q) return;
      setRecentSearches((prev) => [q, ...prev.filter((x) => x !== q)].slice(0, MAX_RECENT_SEARCHES));
    },
    [],
  );

  const backToShelves = useCallback(() => {
    setSellCategoryFilter(CATEGORY_FILTER_ALL);
  }, [setSellCategoryFilter]);

  return {
    searchQuery,
    setSearchQuery,
    recentSearches,
    setRecentSearches,
    commitSearch,
    sellCategoryKey,
    setSellCategoryFilter,
    backToShelves,
    clearSellView,
    filteredProducts,
    shelfCards,
    sellSearchContext,
    sellRowMatchesSearch,
    productSearchIndex,
    hasSellViewFilter,
    showCatalogShelfGrid,
    catalogShelfDrillDown,
    selectedShelfLabel,
    favoriteIdSet,
  };
}
