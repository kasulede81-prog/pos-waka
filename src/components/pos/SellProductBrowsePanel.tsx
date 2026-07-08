import { memo, useRef } from "react";
import { ArrowLeft, ScanLine, Search, X } from "lucide-react";
import clsx from "clsx";
import type { Language, Product, ShopPreferences } from "../../types";
import { t } from "../../lib/i18n";
import { useSellProductBrowseEngine } from "../../hooks/useSellProductBrowseEngine";
import { useSellBarcodeScanner } from "../../hooks/useSellBarcodeScanner";
import { useCatalogContainerWidth } from "../../hooks/useCatalogContainerWidth";
import { usePharmacyTerms } from "../../lib/pharmacyTerms";
import { isPharmacyMode } from "../../lib/pharmacy";
import { CATEGORY_FILTER_ALL } from "../../lib/productCategories";
import { PosSellCatalogShelfSection } from "./PosSellCatalogShelfSection";
import { VirtualizedProductGrid } from "./VirtualizedProductGrid";

export type SellProductBrowsePanelProps = {
  lang: Language;
  products: Product[];
  preferences: ShopPreferences;
  onPick: (product: Product) => void;
  onBarcodeNotFound?: (code: string) => void;
  isLocked?: (product: Product) => boolean;
  lockedBadge?: string;
  /** Pharmacy workspace uses ephemeral category (does not mutate POS prefs). */
  ephemeralCategory?: boolean;
  className?: string;
  searchPlaceholder?: string;
};

export const SellProductBrowsePanel = memo(function SellProductBrowsePanel({
  lang,
  products,
  preferences,
  onPick,
  onBarcodeNotFound,
  isLocked,
  lockedBadge,
  ephemeralCategory = false,
  className,
  searchPlaceholder,
}: SellProductBrowsePanelProps) {
  const catalogRef = useRef<HTMLDivElement>(null);
  const { columnCount } = useCatalogContainerWidth(catalogRef);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const modeTerm = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);

  const browse = useSellProductBrowseEngine({
    lang,
    products,
    preferences,
    ephemeralCategory,
  });

  const barcode = useSellBarcodeScanner({
    lang,
    products,
    setSearchQuery: browse.setSearchQuery,
    onProductScanned: (product) => onPick(product),
    onNotFound: onBarcodeNotFound,
  });

  const gridVariant = pharmacyMode ? "pharmacyMedicine" : "sellMobile";
  const placeholder =
    searchPlaceholder ??
    (pharmacyMode ? modeTerm("searchPlaceholder") : t(lang, "posSellSearchPlaceholder"));

  const showShelf = browse.showCatalogShelfGrid && browse.sellCategoryKey === CATEGORY_FILTER_ALL;
  const showDrillDown = browse.sellCategoryKey !== CATEGORY_FILTER_ALL && browse.sellSearchContext.q.length === 0;
  const showSearchResults = browse.sellSearchContext.q.length > 0;

  return (
    <div className={clsx("flex min-h-0 flex-1 flex-col", className)} data-pos-catalog-scroll>
      <div className="shrink-0 space-y-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            value={browse.searchQuery}
            onChange={(e) => browse.setSearchQuery(e.target.value)}
            onBlur={(e) => browse.commitSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") browse.commitSearch(browse.searchQuery);
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="pos-ds-input h-12 w-full rounded-2xl border border-stone-200 bg-white pl-9 pr-10 text-base font-semibold text-stone-900 outline-none ring-waka-200 placeholder:text-stone-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-200/80"
          />
          <button
            type="button"
            className="absolute right-1.5 top-1/2 flex h-11 min-h-[44px] w-11 min-w-[44px] -translate-y-1/2 items-center justify-center rounded-xl text-stone-500 active:bg-stone-100"
            onClick={() => {
              if (browse.searchQuery.trim()) browse.setSearchQuery("");
              else barcode.openCameraScan();
            }}
            aria-label={browse.searchQuery.trim() ? t(lang, "posClearSearch") : t(lang, "posBarcodeSoon")}
          >
            {browse.searchQuery.trim() ? <X className="h-4 w-4" /> : <ScanLine className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div ref={catalogRef} className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        {showShelf ? (
          <PosSellCatalogShelfSection
            lang={lang}
            shelves={browse.shelfCards}
            onShelfTap={(key) => browse.setSellCategoryFilter(key)}
            desktop
          />
        ) : null}

        {showDrillDown || showSearchResults ? (
          <section className="space-y-2">
            {showDrillDown ? (
              <button
                type="button"
                onClick={() => browse.setSellCategoryFilter(CATEGORY_FILTER_ALL)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-2 text-sm font-black text-teal-800 touch-manipulation"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {browse.selectedShelfLabel}
              </button>
            ) : null}
            {browse.filteredProducts.length === 0 ? (
              <p className="py-10 text-center text-sm font-semibold text-stone-500">{t(lang, "posSellNoMatch")}</p>
            ) : (
              <VirtualizedProductGrid
                products={browse.filteredProducts}
                columnCount={columnCount}
                onPick={onPick}
                stockLabel={t(lang, "stockOnHand")}
                noShelfLabel={t(lang, "posNoShelf")}
                addLabel={t(lang, "add")}
                isLocked={isLocked}
                lockedBadge={lockedBadge}
                variant={gridVariant}
                lang={pharmacyMode ? lang : undefined}
              />
            )}
          </section>
        ) : null}
      </div>

      {barcode.cameraScanOpen ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-stone-950/80 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-4 shadow-2xl">
            <video ref={barcode.cameraVideoRef} className="aspect-video w-full rounded-2xl bg-stone-900 object-cover" playsInline muted />
            <p className="mt-2 text-xs font-semibold text-stone-600">{barcode.cameraScanStatus || t(lang, "posBarcodeSoon")}</p>
            <button
              type="button"
              onClick={barcode.closeCameraScan}
              className="mt-3 min-h-[48px] w-full rounded-2xl border border-stone-200 font-black"
            >
              {t(lang, "cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
