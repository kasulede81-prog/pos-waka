import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { dateKeyKampala, dateKeyDaysAgoKampala } from "../lib/datesUg";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { canSeeOfficeProfit, computeProfitGroupedByCategory } from "../lib/homeProfit";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { PageHeader } from "../components/layout/PageHeader";

type Range = "today" | "week" | "month";

type Props = { lang: Language };

export function ProfitPage({ lang }: Props) {
  const actor = useSessionActor();
  const { authMode, snapshot } = useSubscription();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [range, setRange] = useState<Range>("today");
  const sales = useDeferredReportingSales(includeArchived);
  const returnRecords = usePosStore((s) => s.returnRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);
  const allReturnRecords = includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords;
  const products = usePosStore((s) => s.products);

  if (!canSeeOfficeProfit(actor.role, authMode) || !hasEffectivePermission(actor.role, "reports.profit", snapshot, authMode)) {
    return <Navigate to="/upgrade" replace />;
  }

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const generalLabel = t(lang, "uncategorized");

  const filteredSales = useMemo(() => {
    const today = dateKeyKampala(new Date());
    const weekCut = dateKeyDaysAgoKampala(6);
    const monthPrefix = today.slice(0, 7);
    return sales.filter((s) => {
      const k = dateKeyKampala(s.createdAt);
      if (range === "today") return k === today;
      if (range === "week") return k >= weekCut;
      return k.startsWith(monthPrefix);
    });
  }, [sales, range]);

  const filteredReturns = useMemo(() => {
    const today = dateKeyKampala(new Date());
    const weekCut = dateKeyDaysAgoKampala(6);
    const monthPrefix = today.slice(0, 7);
    return allReturnRecords.filter((r) => {
      const k = dateKeyKampala(r.createdAt);
      if (range === "today") return k === today;
      if (range === "week") return k >= weekCut;
      return k.startsWith(monthPrefix);
    });
  }, [allReturnRecords, range]);

  const report = useMemo(
    () => computeProfitGroupedByCategory(filteredSales, productById, generalLabel, filteredReturns),
    [filteredSales, productById, generalLabel, filteredReturns],
  );

  const { groups, total } = report;

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        lang={lang}
        title={t(lang, "profitPageTitle")}
        subtitle={t(lang, "profitPageSub")}
        backLabel={t(lang, "officeBackToHub")}
      />

      <div className="flex gap-2">
        {(["today", "week", "month"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`flex-1 rounded-2xl py-3 text-sm font-bold ${
              range === r ? "bg-waka-600 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200"
            }`}
          >
            {t(lang, `range_${r}`)}
          </button>
        ))}
      </div>

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      <section className="rounded-3xl border-2 border-waka-200 bg-gradient-to-br from-waka-50 to-white p-5 shadow-waka-sm">
        <p className="text-xs font-black uppercase tracking-wide text-waka-800">{t(lang, "profitPageTotalLabel")}</p>
        <p className={`mt-1 text-4xl font-black ${total.profitUgx < 0 ? "text-stone-600" : "text-waka-950"}`}>
          UGX {total.profitUgx.toLocaleString()}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-white/90 px-3 py-2 ring-1 ring-waka-100">
            <dt className="text-[10px] font-black uppercase text-stone-500">{t(lang, "homeProfitSalesLabel")}</dt>
            <dd className="font-black text-stone-900">UGX {total.salesUgx.toLocaleString()}</dd>
          </div>
          <div className="rounded-2xl bg-white/90 px-3 py-2 ring-1 ring-waka-100">
            <dt className="text-[10px] font-black uppercase text-stone-500">{t(lang, "homeProfitCostLabel")}</dt>
            <dd className="font-black text-stone-900">UGX {total.costUgx.toLocaleString()}</dd>
          </div>
        </dl>
        {total.linesMissingCost > 0 ? (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
            {t(lang, "homeProfitMissingCost").replace("{{count}}", String(total.linesMissingCost))}{" "}
            <Link to="/stock" className="font-black text-waka-800 underline">
              {t(lang, "homeProfitAddCostCta")}
            </Link>
          </p>
        ) : null}
      </section>

      {groups.length === 0 ? (
        <p className="rounded-3xl border border-stone-200 bg-white p-6 text-center text-base font-semibold text-stone-600">
          {t(lang, "profitPageEmpty")}
        </p>
      ) : (
        <ul className="space-y-4">
          {groups.map((g) => (
            <li key={g.categoryKey} className="rounded-3xl border border-stone-200 bg-white shadow-waka-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-100 px-4 py-3">
                <h2 className="text-lg font-black text-stone-900">{g.categoryLabel}</h2>
                <p className="text-sm font-black text-waka-800">
                  {t(lang, "profitPageGroupTotal")}: UGX {g.profitUgx.toLocaleString()}
                </p>
              </div>
              <ul className="divide-y divide-stone-100">
                {g.products.map((p) => (
                  <li key={p.productId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-bold text-stone-900">{p.name}</p>
                      <p className="text-xs font-medium text-stone-500">
                        {t(lang, "profitPageQtySold")}: {p.qty.toLocaleString()} · {t(lang, "profitPageSoldFor")}: UGX{" "}
                        {p.salesUgx.toLocaleString()}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 text-lg font-black ${p.profitUgx < 0 ? "text-stone-600" : "text-waka-800"}`}
                    >
                      UGX {p.profitUgx.toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
