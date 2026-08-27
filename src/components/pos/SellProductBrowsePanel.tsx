import { memo, useRef } from "react";
import { ScanLine, Search, X } from "lucide-react";
import clsx from "clsx";
import type { Language, Product, ShopPreferences } from "../../types";
import { t } from "../../lib/i18n";
import { useSellProductBrowseEngine } from "../../hooks/useSellProductBrowseEngine";
import { useSellBarcodeScanner } from "../../hooks/useSellBarcodeScanner";
import { useCatalogContainerWidth } from "../../hooks/useCatalogContainerWidth";
import { usePosViewportWidth } from "../../hooks/usePosViewportWidth";
import { isWakaMobile } from "../../lib/responsiveBreakpoints";
import { usePharmacyTerms } from "../../lib/pharmacyTerms";
import { isPharmacyMode } from "../../lib/pharmacy";
import { CATEGORY_FILTER_ALL } from "../../lib/productCategories";
import { PosSellCatalogShelfSection } from "./PosSellCatalogShelfSection";
import { PosShelfDrillDownHeader } from "./PosShelfDrillDownHeader";
import { VirtualizedProductGrid } from "./VirtualizedProductGrid";

export type SellProductBrowsePanelProps = {
  lang: Language;
  products: Product[];
  preferences: ShopPreferences;
  onPick: (product: Product) => void;
  onBarcodeNotFound?: (code: string) => void;
  isLocked?: (product: Product) => boolean;
  lockedBadge?: string;
  /**
   * @deprecated Phase 32.3 — Retail + Pharmacy share persisted shelf filter.
   * Kept for call-site compatibility; ignored when omitted/false.
   */
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
  className,
  searchPlaceholder,
}: SellProductBrowsePanelProps) {
  const catalogRef = useRef<HTMLDivElement>(null);
  const viewportWidth = usePosViewportWidth();
  const { columnCount } = useCatalogContainerWidth(catalogRef, {
    phoneBand: isWakaMobile(viewportWidth),
    stabilizeDensity: true,
  });
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const modeTerm = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);

  const browse = useSellProductBrowseEngine({
    lang,
    products,
    preferences,
    ephemeralCategory: false,
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

  const showHierarchyRoot =
    browse.hierarchyEnabled && browse.hierarchyAtRoot && browse.sellSearchContext.q.length === 0;
  const showHierarchyNested =
    browse.hierarchyEnabled && !browse.hierarchyAtRoot && browse.sellSearchContext.q.length === 0;
  const showShelf =
    !browse.hierarchyEnabled &&
    browse.showCatalogShelfGrid &&
    browse.sellCategoryKey === CATEGORY_FILTER_ALL;
  const showDrillDown = browse.hierarchyEnabled ? showHierarchyNested : browse.catalogShelfDrillDown;
  const showSearchResults = browse.sellSearchContext.q.length > 0;
  const landingShelves = showHierarchyRoot ? browse.hierarchyFolderCards : browse.shelfCards;

  return (
    <div className={clsx("flex h-full min-h-0 flex-1 flex-col", className)}>
      <div className="shrink-0 space-y-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={browse.searchQuery}
            onChange={(e) => browse.setSearchQuery(e.target.value)}
            onBlur={(e) => browse.commitSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") browse.commitSearch(browse.searchQuery);
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="pos-ds-input h-12 w-full rounded-2xl border border-border bg-card pl-9 pr-10 text-base font-semibold text-foreground outline-none ring-waka-200 placeholder:text-muted-foreground focus:border-teal-400 focus:ring-2 focus:ring-teal-200/80"
          />
          <button
            type="button"
            className="absolute right-1.5 top-1/2 flex h-11 min-h-[44px] w-11 min-w-[44px] -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground active:bg-muted"
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

      <div
        ref={catalogRef}
        className="pos-catalog-scroll-pane pos-catalog-scroll-pane--browse mt-3 h-0 min-h-0 flex-1"
        data-pos-catalog-scroll
      >
        {showShelf || showHierarchyRoot ? (
          <PosSellCatalogShelfSection
            lang={lang}
            shelves={landingShelves}
            onShelfTap={(key) =>
              browse.hierarchyEnabled ? browse.openCatalogFolder(key) : browse.setSellCategoryFilter(key)
            }
          />
        ) : null}

        {showDrillDown || showSearchResults ? (
          <section className="space-y-2">
            {showDrillDown ? (
              <PosShelfDrillDownHeader
                lang={lang}
                shelfLabel={browse.selectedShelfLabel}
                productCount={browse.filteredProducts.length}
                onBack={browse.backToShelves}
                path={showHierarchyNested ? browse.hierarchyPath : undefined}
                onPathSelect={showHierarchyNested ? browse.jumpCatalogPath : undefined}
              />
            ) : null}
            {showHierarchyNested && browse.hierarchyFolderCards.length > 0 ? (
              <PosSellCatalogShelfSection
                lang={lang}
                shelves={browse.hierarchyFolderCards}
                onShelfTap={(key) => browse.openCatalogFolder(key)}
                nested
              />
            ) : null}
            {browse.filteredProducts.length === 0 ? (
              showHierarchyNested && browse.hierarchyFolderCards.length > 0 ? null : (
                <p className="py-10 text-center text-sm font-semibold text-muted-foreground">{t(lang, "posSellNoMatch")}</p>
              )
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
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-foreground/80 p-4">
          <div className="w-full max-w-md rounded-3xl bg-card p-4 shadow-2xl">
            <video ref={barcode.cameraVideoRef} className="aspect-video w-full rounded-2xl bg-foreground object-cover" playsInline muted />
            <p className="mt-2 text-xs font-semibold text-muted-foreground">{barcode.cameraScanStatus || t(lang, "posBarcodeSoon")}</p>
            <button
              type="button"
              onClick={barcode.closeCameraScan}
              className="mt-3 min-h-[48px] w-full rounded-2xl border border-border font-black"
            >
              {t(lang, "cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
