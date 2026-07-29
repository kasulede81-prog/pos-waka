import { useState } from "react";
import { Download, Filter, MoreHorizontal, Printer } from "lucide-react";
import type { Language, Product, Supplier } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../../components/layout/ModalSheet";
import { EnterpriseActionSheet } from "../../components/enterprise/EnterpriseActionSheet";
import { InventoryFilterBar } from "./filters/InventoryFilterBar";
import type { InventoryAdvancedFilters, InventorySavedFilterPreset } from "./filters/types";
import { countActiveAdvancedFilters } from "./filters/types";
import { StockListToolbar } from "../../components/stock/StockListToolbar";
import { InventoryViewSwitcher } from "./viewEngine/InventoryViewSwitcher";
import { InventorySelectionModeButton } from "./selection/InventorySelectionModeButton";
import { buildProductCatalogCsv, productCatalogExportFilename } from "./export/productCatalogExport";
import { printProductLabels, exportProductLabelsHtml } from "./export/productLabelPrint";
import { saveExportedFile } from "../../lib/fileDownload";

type ListSort = "name_az" | "name_za" | "stock_low" | "updated";

type Props = {
  lang: Language;
  /** Phone band — consolidate secondary controls into sheets. */
  isPhone: boolean;
  filters: InventoryAdvancedFilters;
  onChangeFilters: (next: InventoryAdvancedFilters) => void;
  query: string;
  onQueryChange: (q: string) => void;
  products: Product[];
  filteredProducts: Product[];
  suppliers: Supplier[];
  lastSupplierByProductId: Map<string, { supplierId: string; supplierName: string }>;
  stockCategoryPicklist: string[];
  savedPresets: InventorySavedFilterPreset[];
  onSavePreset: (name: string) => void;
  onApplyPreset: (preset: InventorySavedFilterPreset) => void;
  listSort: ListSort;
  onListSort: (s: ListSort) => void;
  listFilter: "all" | "low";
  onListFilter: (f: "all" | "low") => void;
  stockCategoryFilter: string;
  onStockCategoryFilter: (c: string) => void;
  stockHasUncategorized: boolean;
  groupByCategory: boolean;
  onGroupByCategory: (v: boolean) => void;
};

/**
 * Phase 27.1 — phones: one Filter & View control + overflow for export.
 * Tablet/desktop: keep existing inline toolbars.
 *
 * Control density (≤768):
 * - Primary: search (always visible)
 * - Secondary: filters / sort / view / selection → Filter & View sheet; export → overflow
 * - Advanced: desktop/tablet inline toolbar only
 */
export function InventoryProductsControlBar(props: Props) {
  const {
    lang,
    isPhone,
    filters,
    onChangeFilters,
    query,
    onQueryChange,
    products,
    filteredProducts,
    suppliers,
    lastSupplierByProductId,
    stockCategoryPicklist,
    savedPresets,
    onSavePreset,
    onApplyPreset,
    listSort,
    onListSort,
    listFilter,
    onListFilter,
    stockCategoryFilter,
    onStockCategoryFilter,
    stockHasUncategorized,
    groupByCategory,
    onGroupByCategory,
  } = props;

  const [filterOpen, setFilterOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const activeFilterCount = countActiveAdvancedFilters(filters) + (listFilter === "low" ? 1 : 0);

  const exportFiltered = async () => {
    const csv = buildProductCatalogCsv(lang, filteredProducts);
    await saveExportedFile(productCatalogExportFilename("filtered"), csv, "text/csv");
  };

  const exportLabels = () => {
    exportProductLabelsHtml(lang, filteredProducts.slice(0, 50));
  };

  const printLabels = () => {
    printProductLabels(lang, filteredProducts.slice(0, 50));
  };

  if (!isPhone) {
    return (
      <section className="space-y-3">
        <InventoryFilterBar
          lang={lang}
          filters={filters}
          onChange={onChangeFilters}
          query={query}
          onQueryChange={onQueryChange}
          products={products}
          suppliers={suppliers}
          lastSupplierByProductId={lastSupplierByProductId}
          stockCategoryPicklist={stockCategoryPicklist}
          savedPresets={savedPresets}
          onSavePreset={onSavePreset}
          onApplyPreset={onApplyPreset}
          compact
        />
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <StockListToolbar
              lang={lang}
              listSort={listSort}
              onListSort={onListSort}
              listFilter={listFilter}
              onListFilter={onListFilter}
              stockCategoryFilter={stockCategoryFilter}
              onStockCategoryFilter={onStockCategoryFilter}
              stockCategoryPicklist={stockCategoryPicklist}
              stockHasUncategorized={stockHasUncategorized}
              groupByCategory={groupByCategory}
              onGroupByCategory={onGroupByCategory}
              compact
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <InventorySelectionModeButton lang={lang} />
            <InventoryViewSwitcher lang={lang} variant="toolbar" />
            <button
              type="button"
              onClick={() => void exportFiltered()}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-black text-muted-foreground hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t(lang, "inventoryExportFiltered")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t(lang, "inventorySearchPlaceholder")}
            className="min-h-[44px] w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground"
            aria-label={t(lang, "inventorySearchPlaceholder")}
          />
        </div>
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground"
          aria-expanded={filterOpen}
        >
          <Filter className="h-4 w-4" aria-hidden />
          {t(lang, "inventoryFilterAndView")}
          {activeFilterCount > 0 ? (
            <span className="rounded-full bg-waka-600 px-1.5 py-0.5 text-[10px] text-white">{activeFilterCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setOverflowOpen(true)}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground"
          aria-label={t(lang, "stockMoreActions")}
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <ModalSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title={t(lang, "inventoryFilterAndView")}
        align="bottom"
        zIndexClass="z-[70]"
        footer={
          <button
            type="button"
            onClick={() => setFilterOpen(false)}
            className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-waka-600 text-sm font-black text-white"
          >
            {t(lang, "inventoryFilterDone")}
          </button>
        }
      >
        <div className="space-y-4">
          <InventoryFilterBar
            lang={lang}
            filters={filters}
            onChange={onChangeFilters}
            query={query}
            onQueryChange={onQueryChange}
            products={products}
            suppliers={suppliers}
            lastSupplierByProductId={lastSupplierByProductId}
            stockCategoryPicklist={stockCategoryPicklist}
            savedPresets={savedPresets}
            onSavePreset={onSavePreset}
            onApplyPreset={onApplyPreset}
            compact
          />
          <StockListToolbar
            lang={lang}
            listSort={listSort}
            onListSort={onListSort}
            listFilter={listFilter}
            onListFilter={onListFilter}
            stockCategoryFilter={stockCategoryFilter}
            onStockCategoryFilter={onStockCategoryFilter}
            stockCategoryPicklist={stockCategoryPicklist}
            stockHasUncategorized={stockHasUncategorized}
            groupByCategory={groupByCategory}
            onGroupByCategory={onGroupByCategory}
            compact
          />
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
              {t(lang, "inventoryViewSwitcherLabel")}
            </p>
            <InventoryViewSwitcher lang={lang} variant="toolbar" />
          </div>
          <InventorySelectionModeButton lang={lang} />
        </div>
      </ModalSheet>

      <EnterpriseActionSheet
        open={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        title={t(lang, "stockMoreActions")}
        cancelLabel={t(lang, "cancel")}
        actions={[
          {
            id: "export",
            label: t(lang, "inventoryExportFiltered"),
            icon: <Download className="h-4 w-4" aria-hidden />,
            onClick: () => void exportFiltered(),
          },
          {
            id: "labels",
            label: t(lang, "inventoryPrintLabels"),
            icon: <Printer className="h-4 w-4" aria-hidden />,
            onClick: printLabels,
          },
          {
            id: "labelsHtml",
            label: t(lang, "inventoryExportLabels"),
            icon: <Download className="h-4 w-4" aria-hidden />,
            onClick: exportLabels,
          },
        ]}
      />
    </section>
  );
}
