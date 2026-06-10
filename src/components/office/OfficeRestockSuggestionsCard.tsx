import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useReportingSales } from "../../hooks/useReportingSales";
import { buildRestockProductSuggestions } from "../../lib/purchaseReporting";
import { buildRestockSuggestions } from "../../lib/restockSuggestions";
import { hasPermission } from "../../lib/permissions";
import { useSessionActor } from "../../context/SessionActorContext";

export function OfficeRestockSuggestionsCard({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canRestock = hasPermission(actor.role, "purchases.record");
  const products = usePosStore((s) => s.products);
  const purchases = usePosStore((s) => s.purchases);
  const sales = useReportingSales(false);

  const suggestions = useMemo(
    () => buildRestockProductSuggestions(products, sales, 6),
    [products, sales],
  );

  const hintLines = useMemo(
    () => buildRestockSuggestions(lang, products, sales, purchases, 3),
    [lang, products, sales, purchases],
  );

  if (!canRestock || (suggestions.length === 0 && hintLines.length === 0)) return null;

  return (
    <section className="rounded-3xl border border-waka-200 bg-waka-50/50 p-5 shadow-waka-sm">
      <div className="flex items-start gap-3">
        <Package className="h-7 w-7 shrink-0 text-waka-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-black text-waka-950">{t(lang, "officeRestockSuggestionsTitle")}</h2>
          <p className="mt-0.5 text-sm font-medium text-stone-600">{t(lang, "officeRestockSuggestionsSub")}</p>
        </div>
      </div>
      {suggestions.length === 0 ? (
        <p className="mt-3 text-sm font-medium text-stone-600">{t(lang, "officeRestockSuggestionsEmpty")}</p>
      ) : null}
      <ul className="mt-4 space-y-2">
        {suggestions.map((row) => (
          <li key={row.productId}>
            <Link
              to="/restock"
              className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100 transition-colors hover:bg-waka-50"
            >
              <div className="min-w-0">
                <p className="truncate font-bold text-stone-900">{row.name}</p>
                <p className="mt-0.5 text-xs font-semibold text-stone-500">
                  {t(lang, "officeRestockSuggestionsStock")}: {row.stockOnHand} · {t(lang, "officeRestockSuggestionsMin")}:{" "}
                  {row.minimumStock} · {t(lang, "officeRestockSuggestionsSuggest")}: {row.suggestedQty}
                </p>
                <p className="text-[10px] font-bold uppercase text-waka-700">
                  {row.reason === "low"
                    ? t(lang, "officeRestockSuggestionsLow")
                    : t(lang, "officeRestockSuggestionsRunning")}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {hintLines.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-waka-100 pt-3">
          {hintLines.map((line) => (
            <li key={line} className="text-xs font-semibold text-stone-600">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
