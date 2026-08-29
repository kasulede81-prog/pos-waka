import type { Language } from "../../types";
import { StockQuickActionsGrid } from "./StockQuickActionsGrid";

type Props = {
  lang: Language;
  canAdd: boolean;
  canRestock: boolean;
  canArrangeShelves: boolean;
  freeProductLimitReached: boolean;
  onAddProduct: () => void;
  onImportProducts?: () => void;
  showImport?: boolean;
  onCsvImport?: () => void;
  showCsvImport?: boolean;
};

export function StockOverviewPanel({
  lang,
  canAdd,
  canRestock,
  canArrangeShelves,
  freeProductLimitReached,
  onAddProduct,
  onImportProducts,
  showImport,
  onCsvImport,
  showCsvImport,
}: Props) {
  return (
    <StockQuickActionsGrid
      lang={lang}
      canAdd={canAdd}
      canRestock={canRestock}
      canArrangeShelves={canArrangeShelves}
      freeProductLimitReached={freeProductLimitReached}
      onAddProduct={onAddProduct}
      onImportProducts={onImportProducts}
      showImport={showImport}
      onCsvImport={onCsvImport}
      showCsvImport={showCsvImport}
    />
  );
}
