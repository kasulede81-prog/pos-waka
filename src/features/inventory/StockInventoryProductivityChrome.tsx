import { useCallback } from "react";
import type { Language, Product, ShopPreferences, Supplier } from "../../types";
import { useInventorySelection } from "./selection/useInventorySelection";
import { InventoryBulkToolbar } from "./bulk/InventoryBulkToolbar";
import { useInventoryKeyboardShortcuts } from "./keyboard/useInventoryKeyboardShortcuts";
import { buildProductCatalogCsv, productCatalogExportFilename } from "./export/productCatalogExport";
import { printProductLabels } from "./export/productLabelPrint";
import { runInventoryBulkOperation, selectedProducts } from "./bulk/InventoryBulkOperations";
import { saveExportedFile } from "../../lib/fileDownload";
import { usePosStore } from "../../store/usePosStore";

type Props = {
  lang: Language;
  enabled: boolean;
  products: Product[];
  filteredProducts: Product[];
  preferences: ShopPreferences;
  suppliers: Supplier[];
  canEdit: boolean;
  canAdjust: boolean;
  stockCategoryPicklist: string[];
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  filteredIds: readonly string[];
};

export function StockInventoryProductivityChrome({
  lang,
  enabled,
  products,
  filteredProducts,
  preferences,
  suppliers,
  canEdit,
  canAdjust,
  stockCategoryPicklist,
  searchInputRef,
  filteredIds,
}: Props) {
  const { selectFiltered, clear, exit, state } = useInventorySelection();
  const updateProduct = usePosStore((s) => s.updateProduct);
  const adjustStock = usePosStore((s) => s.adjustStock);
  const setPreferences = usePosStore((s) => s.setPreferences);

  const onSelectAll = useCallback(() => {
    selectFiltered(filteredIds);
  }, [selectFiltered, filteredIds]);

  const onClearSelection = useCallback(() => {
    clear();
    exit();
  }, [clear, exit]);

  const onArchive = useCallback(() => {
    if (state.selectedIds.size === 0) return;
    void runInventoryBulkOperation(
      { kind: "archive" },
      {
        lang,
        products,
        selectedIds: state.selectedIds,
        preferences,
        store: { updateProduct, adjustStock, setPreferences },
      },
    );
  }, [lang, products, preferences, state.selectedIds, updateProduct, adjustStock, setPreferences]);

  useInventoryKeyboardShortcuts({
    enabled,
    onSelectAll,
    onClearSelection,
    onArchive: canEdit ? onArchive : undefined,
    onFocusSearch: () => searchInputRef.current?.focus(),
    onExport: () => {
      const csv = buildProductCatalogCsv(lang, filteredProducts);
      void saveExportedFile(productCatalogExportFilename("filtered"), csv, "text/csv");
    },
    onPrintLabels: () => {
      const sel = selectedProducts(products, state.selectedIds);
      printProductLabels(lang, sel.length > 0 ? sel : filteredProducts.slice(0, 50));
    },
  });

  return (
    <InventoryBulkToolbar
      lang={lang}
      products={products}
      filteredProducts={filteredProducts}
      preferences={preferences}
      suppliers={suppliers}
      canEdit={canEdit}
      canAdjust={canAdjust}
      stockCategoryPicklist={stockCategoryPicklist}
      onClearSelection={onClearSelection}
    />
  );
}
