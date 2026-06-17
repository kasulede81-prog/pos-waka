import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useReportingSales } from "../../hooks/useReportingSales";
import { buildRestockProductSuggestions } from "../../lib/purchaseReporting";
import { HistoryListCard } from "../shared/HistoryListCard";

type FastMover = { name: string; qty: number; revenue: number };

type Props = {
  lang: Language;
  lowStock: Product[];
  fastMovers: FastMover[];
};

export function OwnerInventoryHealthSection({ lang, lowStock, fastMovers }: Props) {
  const products = usePosStore((s) => s.products);
  const sales = useReportingSales(false);

  const suggestions = useMemo(() => buildRestockProductSuggestions(products, sales, 5), [products, sales]);

  const badgeCount = lowStock.length + suggestions.length;

  return (
    <div className="space-y-4">
      <HistoryListCard
        isEmpty={lowStock.length === 0}
        empty={<p className="text-sm font-semibold text-slate-600">{t(lang, "allStockOk")}</p>}
      >
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <div>
            <h2 className="text-base font-black text-slate-950">{t(lang, "lowStockTitleFriendly")}</h2>
            <p className="text-xs font-semibold text-slate-500">{t(lang, "ownerSectionInventoryHealthSub")}</p>
          </div>
          {badgeCount > 0 ? (
            <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-black text-rose-950">{lowStock.length}</span>
          ) : null}
        </div>
        <ul className="divide-y divide-stone-100">
          {lowStock.slice(0, 8).map((p) => (
            <li key={p.id}>
              <Link
                to="/stock"
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-rose-50/60"
              >
                <span className="min-w-0 truncate text-sm font-semibold text-rose-950">{p.name}</span>
                <span className="shrink-0 text-sm font-black tabular-nums text-rose-800">
                  {p.stockOnHand} {p.baseUnit}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t border-stone-100 p-4">
          <Link to="/stock" className="text-sm font-black text-waka-700">
            {t(lang, "navStock")} →
          </Link>
        </div>
      </HistoryListCard>

      <HistoryListCard
        isEmpty={fastMovers.length === 0}
        empty={<p className="text-sm font-semibold text-slate-500">{t(lang, "noSalesYet")}</p>}
      >
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <h3 className="text-base font-black text-slate-950">{t(lang, "fastToday")}</h3>
          <Link to="/reports" className="text-xs font-black text-waka-700">
            {t(lang, "reports")} →
          </Link>
        </div>
        <ul className="divide-y divide-stone-100">
          {fastMovers.slice(0, 6).map((m) => (
            <li key={m.name}>
              <Link
                to="/reports"
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-stone-50"
              >
                <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{m.name}</span>
                <span className="shrink-0 text-sm font-black text-waka-700">UGX {m.revenue.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      </HistoryListCard>

      {suggestions.length > 0 ? (
        <HistoryListCard>
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <h3 className="text-base font-black text-slate-950">{t(lang, "officeRestockSuggestionsTitle")}</h3>
            <Link to="/restock" className="text-xs font-black text-waka-700">
              {t(lang, "stockGoRestock")} →
            </Link>
          </div>
          <ul className="divide-y divide-stone-100">
            {suggestions.map((row) => (
              <li key={row.productId}>
                <Link
                  to="/restock"
                  className="block px-4 py-3 transition-colors hover:bg-waka-50/60"
                >
                  <span className="text-sm font-bold text-slate-900">{row.name}</span>
                  <span className="mt-0.5 block text-xs font-semibold text-slate-600">
                    {t(lang, "officeRestockSuggestionsSuggest")}: {row.suggestedQty}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </HistoryListCard>
      ) : null}
    </div>
  );
}
