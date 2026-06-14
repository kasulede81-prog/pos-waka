import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useReportingSales } from "../../hooks/useReportingSales";
import { buildRestockProductSuggestions } from "../../lib/purchaseReporting";
import { OwnerDashboardSection } from "./OwnerDashboardSection";

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
    <OwnerDashboardSection
      title={t(lang, "ownerSectionInventoryHealth")}
      subtitle={t(lang, "ownerSectionInventoryHealthSub")}
      badgeCount={badgeCount}
      defaultOpen={badgeCount > 0}
    >
      <div className="space-y-4">
        <div>
          <Link to="/stock" className="text-xs font-black uppercase tracking-wide text-rose-800 hover:underline">
            {t(lang, "lowStockTitleFriendly")} →
          </Link>
          {lowStock.length === 0 ? (
            <p className="mt-2 text-sm font-semibold text-slate-600">{t(lang, "allStockOk")}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {lowStock.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link
                    to="/stock"
                    className="flex justify-between rounded-xl bg-rose-50/80 px-3 py-2 text-sm font-semibold text-rose-950 hover:bg-rose-100"
                  >
                    <span className="min-w-0 truncate">{p.name}</span>
                    <span className="shrink-0 tabular-nums">
                      {p.stockOnHand} {p.baseUnit}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <Link to="/reports" className="text-xs font-black uppercase tracking-wide text-waka-800 hover:underline">
            {t(lang, "fastToday")} →
          </Link>
          {fastMovers.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">{t(lang, "noSalesYet")}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {fastMovers.slice(0, 5).map((m) => (
                <li key={m.name}>
                  <Link
                    to="/reports"
                    className="flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold hover:bg-waka-50"
                  >
                    <span className="min-w-0 truncate">{m.name}</span>
                    <span className="shrink-0 text-waka-700">UGX {m.revenue.toLocaleString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {suggestions.length > 0 ? (
          <div>
            <Link to="/restock" className="text-xs font-black uppercase tracking-wide text-waka-800 hover:underline">
              {t(lang, "officeRestockSuggestionsTitle")} →
            </Link>
            <ul className="mt-2 space-y-1">
              {suggestions.map((row) => (
                <li key={row.productId}>
                  <Link
                    to="/restock"
                    className="block rounded-xl bg-waka-50/80 px-3 py-2 text-sm font-semibold text-stone-800 hover:bg-waka-100"
                  >
                    <span className="font-bold">{row.name}</span>
                    <span className="mt-0.5 block text-xs text-stone-600">
                      {t(lang, "officeRestockSuggestionsSuggest")}: {row.suggestedQty}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </OwnerDashboardSection>
  );
}
