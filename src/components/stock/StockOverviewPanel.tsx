import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { InventoryHeroCard } from "./InventoryHeroCard";
import { HistoryListCard } from "../shared/HistoryListCard";

type Props = {
  lang: Language;
  totalProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
  inventoryValueUgx: number;
  canAdd: boolean;
  canRestock: boolean;
  freeProductLimitReached: boolean;
  onAddProduct: () => void;
  aiProductAssistantEnabled?: boolean;
  onAddProductWithAi?: () => void;
  onBulkInventoryWithAi?: () => void;
};

export function StockOverviewPanel({
  lang,
  totalProducts,
  lowStockCount,
  outOfStockCount,
  inventoryValueUgx,
  canAdd,
  canRestock,
  freeProductLimitReached,
  onAddProduct,
  aiProductAssistantEnabled = false,
  onAddProductWithAi,
  onBulkInventoryWithAi,
}: Props) {
  return (
    <div className="space-y-4">
      <InventoryHeroCard
        lang={lang}
        totalProducts={totalProducts}
        lowStockCount={lowStockCount}
        outOfStockCount={outOfStockCount}
        inventoryValueUgx={inventoryValueUgx}
      />

      <HistoryListCard>
        <div className="border-b border-stone-100 px-4 py-3">
          <h3 className="text-base font-black text-slate-950">{t(lang, "ownerSectionQuickActions")}</h3>
        </div>
        <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
          {canAdd ? (
            <button
              type="button"
              disabled={freeProductLimitReached}
              onClick={onAddProduct}
              className="min-h-[52px] rounded-2xl bg-waka-600 text-base font-black text-white shadow-md disabled:opacity-50"
            >
              {t(lang, "stockAddProductBtn")}
            </button>
          ) : null}
          {canAdd && aiProductAssistantEnabled && onAddProductWithAi ? (
            <button
              type="button"
              disabled={freeProductLimitReached}
              onClick={onAddProductWithAi}
              className="min-h-[52px] rounded-2xl border-2 border-violet-300 bg-violet-50 text-base font-black text-violet-950 shadow-sm disabled:opacity-50"
            >
              {t(lang, "aiProductAssistBtn")}
            </button>
          ) : null}
          {canAdd && onBulkInventoryWithAi ? (
            <button
              type="button"
              disabled={freeProductLimitReached}
              onClick={onBulkInventoryWithAi}
              className="min-h-[52px] rounded-2xl border-2 border-violet-200 bg-white text-base font-black text-violet-900 shadow-sm disabled:opacity-50 sm:col-span-2"
            >
              {t(lang, "aiBulkBtn")}
            </button>
          ) : null}
          {canRestock ? (
            <Link
              to="/restock"
              className="flex min-h-[52px] items-center justify-center rounded-2xl border-2 border-waka-300 bg-waka-50 text-base font-black text-waka-950 sm:col-span-2"
            >
              {t(lang, "stockGoRestock")}
            </Link>
          ) : null}
        </div>
      </HistoryListCard>
    </div>
  );
}
