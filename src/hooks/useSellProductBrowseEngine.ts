import { useCallback, useMemo, useState } from "react";
import type { Language, Product, ShopPreferences } from "../types";
import {
  CATEGORY_FILTER_ALL,
  UNCATEGORIZED_SENTINEL,
} from "../lib/productCategories";
import { buildPosShelfDisplayCards, type PosShelfDisplayCard } from "../lib/posShelfLayout";
import { posSearchAliases } from "../lib/pharmacyUx";
import {
  filterIndexedProductsForSellView,
  filterProductsByCategoryOnly,
  productMatchesIndexedSellSearch,
} from "../lib/posProductSearch";
import { useReconciledProductSellSearchIndex } from "./useReconciledProductSearchIndex";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import {
  catalogShopIdFromPreferences,
  isCatalogHierarchyEnabled,
} from "../lib/catalogHierarchy";
import {
  buildCatalogBrowseIndex,
  jumpCatalogBrowseToIdentity,
  popCatalogBrowseIdentity,
  pushCatalogBrowseIdentity,
  resolveSellCatalogHierarchyView,
  type CatalogBrowsePathEntry,
} from "../lib/catalogBrowse";

const EMPTY_SHELF_LAYOUT: Record<string, never> = {};
const EMPTY_SHELF_ORDER: string[] = [];
const EMPTY_CATALOG_NODES: never[] = [];
const EMPTY_HIERARCHY_CARDS: PosShelfDisplayCard[] = [];
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
 *
 * Hierarchy folder navigation is session-only (mobile H2b + desktop/Electron H2c).
 * Flag-off still uses buildPosShelfDisplayCards + exact Product.category filtering.
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
  const [hierarchyPathIds, setHierarchyPathIds] = useState<string[]>([]);

  const searchControlled = typeof controlledSetSearchQuery === "function";
  const searchQuery = searchControlled ? (controlledSearchQuery ?? "") : internalSearchQuery;
  const setSearchQuery = searchControlled ? controlledSetSearchQuery! : setInternalSearchQuery;

  const hierarchyEnabled = isCatalogHierarchyEnabled(preferences);

  const sellCategoryKey = ephemeralCategory
    ? localCategoryKey
    : preferences.posSellCategoryFilter ?? CATEGORY_FILTER_ALL;

  const shelfOrderKeys = preferences.posPinnedShelfKeys ?? EMPTY_SHELF_ORDER;
  const shelfLayout = preferences.posShelfLayout ?? EMPTY_SHELF_LAYOUT;
  const shelfDefaultScale = preferences.posShelfDefaultScale ?? 35;
  const favoriteIdSet = useMemo(() => new Set(preferences.favoriteProductIds ?? []), [preferences.favoriteProductIds]);
  const catalogNodes = preferences.posCatalogNodes ?? EMPTY_CATALOG_NODES;
  const catalogShopId = catalogShopIdFromPreferences(preferences);

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
    setHierarchyPathIds([]);
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

  const productSearchIndex = useReconciledProductSellSearchIndex(products);

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

  const catalogBrowseIndex = useMemo(() => {
    if (!hierarchyEnabled) return null;
    return buildCatalogBrowseIndex({
      products,
      layout: shelfLayout,
      orderKeys: shelfOrderKeys,
      nodes: catalogNodes,
      shopId: catalogShopId,
      uncategorizedLabel: t(lang, "posNoShelf"),
    });
  }, [hierarchyEnabled, products, shelfLayout, shelfOrderKeys, catalogNodes, catalogShopId, lang]);

  const hierarchyView = useMemo(
    () =>
      resolveSellCatalogHierarchyView({
        enabled: hierarchyEnabled,
        path: hierarchyPathIds,
        searchQuery: sellSearchContext.q,
        index: catalogBrowseIndex,
        layout: shelfLayout,
        defaultScale: shelfDefaultScale,
      }),
    [
      hierarchyEnabled,
      hierarchyPathIds,
      sellSearchContext.q,
      catalogBrowseIndex,
      shelfLayout,
      shelfDefaultScale,
    ],
  );

  const hasSellViewFilter = sellCategoryKey !== CATEGORY_FILTER_ALL || sellSearchContext.q.length > 0;
  const showCatalogShelfGrid = sellCategoryKey === CATEGORY_FILTER_ALL && sellSearchContext.q.length === 0;
  const catalogShelfDrillDown = sellCategoryKey !== CATEGORY_FILTER_ALL && sellSearchContext.q.length === 0;

  const selectedShelfLabel =
    hierarchyView?.currentLabel ??
    (sellCategoryKey === UNCATEGORIZED_SENTINEL
      ? t(lang, "posNoShelf")
      : sellCategoryKey === CATEGORY_FILTER_ALL
        ? t(lang, "posCategoryAll")
        : sellCategoryKey);

  const commitSearch = useCallback(
    (raw: string) => {
      const q = raw.trim();
      if (!q) return;
      setRecentSearches((prev) => [q, ...prev.filter((x) => x !== q)].slice(0, MAX_RECENT_SEARCHES));
    },
    [],
  );

  const applyHierarchyPath = useCallback(
    (nextPath: string[]) => {
      setHierarchyPathIds(nextPath);
      const identity = nextPath[nextPath.length - 1];
      setSellCategoryFilter(identity ?? CATEGORY_FILTER_ALL);
    },
    [setSellCategoryFilter],
  );

  const openCatalogFolder = useCallback(
    (identity: string) => {
      if (!hierarchyEnabled || !catalogBrowseIndex) {
        setSellCategoryFilter(identity);
        return;
      }
      applyHierarchyPath(pushCatalogBrowseIdentity(catalogBrowseIndex, hierarchyPathIds, identity));
    },
    [hierarchyEnabled, catalogBrowseIndex, hierarchyPathIds, applyHierarchyPath, setSellCategoryFilter],
  );

  const jumpCatalogPath = useCallback(
    (identity: string | null) => {
      if (!hierarchyEnabled || !catalogBrowseIndex) {
        setSellCategoryFilter(identity ?? CATEGORY_FILTER_ALL);
        return;
      }
      applyHierarchyPath(jumpCatalogBrowseToIdentity(catalogBrowseIndex, hierarchyPathIds, identity));
    },
    [hierarchyEnabled, catalogBrowseIndex, hierarchyPathIds, applyHierarchyPath, setSellCategoryFilter],
  );

  const backToShelves = useCallback(() => {
    if (hierarchyEnabled && hierarchyPathIds.length > 0) {
      applyHierarchyPath(popCatalogBrowseIdentity(hierarchyPathIds));
      return;
    }
    setSellCategoryFilter(CATEGORY_FILTER_ALL);
  }, [hierarchyEnabled, hierarchyPathIds, applyHierarchyPath, setSellCategoryFilter]);

  const hierarchyFolderCards: PosShelfDisplayCard[] = hierarchyView?.folderCards ?? EMPTY_HIERARCHY_CARDS;
  const hierarchyPath: CatalogBrowsePathEntry[] = hierarchyView?.path ?? [];
  const hierarchyAtRoot = !hierarchyView || hierarchyView.atRoot;

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
    hierarchyEnabled,
    hierarchyAtRoot,
    hierarchyPath,
    hierarchyFolderCards: hierarchyEnabled ? hierarchyFolderCards : EMPTY_HIERARCHY_CARDS,
    openCatalogFolder,
    jumpCatalogPath,
  };
}
