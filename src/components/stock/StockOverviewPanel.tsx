import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";

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
}: Props) {
  const cards = [
    { label: t(lang, "stockStatTotalProducts"), value: String(totalProducts) },
    { label: t(lang, "stockStatLow"), value: String(lowStockCount) },
    { label: t(lang, "stockStatOut"), value: String(outOfStockCount) },
    {
      label: t(lang, "stockStatValue"),
      value: tTemplate(lang, "stockStatValueAmount", { amount: inventoryValueUgx.toLocaleString() }),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <article key={c.label} className="rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className="mt-2 text-xl font-black text-slate-900">{c.value}</p>
          </article>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {canAdd ? (
          <button
            type="button"
            disabled={freeProductLimitReached}
            onClick={onAddProduct}
            className="min-h-[56px] rounded-2xl bg-waka-600 text-lg font-black text-white shadow-md disabled:opacity-50"
          >
            {t(lang, "stockAddProductBtn")}
          </button>
        ) : null}
        {canRestock ? (
          <Link
            to="/restock"
            className="flex min-h-[56px] items-center justify-center rounded-2xl border-2 border-waka-300 bg-waka-50 text-lg font-black text-waka-950"
          >
            {t(lang, "stockGoRestock")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
