import { useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import { TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { returnMatchesFilter, saleMatchesFilter } from "../lib/dateFilters";
import { isCompletedSale } from "../lib/saleStatus";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import { computeProfitGroupedByCategory } from "../lib/homeProfit";
import { PageHeader } from "../components/layout/PageHeader";
import { DateFilterArchiveNotice } from "../components/shared/DateFilterArchiveNotice";
import { HistoryHeroCard } from "../components/shared/HistoryHeroCard";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";

type Props = { lang: Language; embedded?: boolean };

export function ProfitPage({ lang, embedded }: Props) {
  const actor = useSessionActor();
  const { authMode, snapshot } = useSubscription();
  const {
    filter,
    setFilter,
    bounds,
    includeArchived,
    setIncludeArchived,
    archiveNotice,
    archivedSalesCount,
    needsArchive,
  } = useReportingDateFilter();
  const sales = useDeferredReportingSales(includeArchived);
  const returnRecords = usePosStore((s) => s.returnRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);
  const products = usePosStore((s) => s.products);

  const { canProfit: canViewProfit } = resolveProfitVisibility({ role: actor.role, snapshot, authMode });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const generalLabel = t(lang, "uncategorized");

  const filteredSales = useMemo(
    () => sales.filter((s) => isCompletedSale(s) && saleMatchesFilter(s, bounds)),
    [sales, bounds],
  );

  const filteredReturns = useMemo(
    () => {
      const allReturnRecords = includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords;
      return allReturnRecords.filter((r) => returnMatchesFilter(r, bounds));
    },
    [includeArchived, returnRecords, archivedReturnRecords, bounds],
  );

  const report = useMemo(
    () => computeProfitGroupedByCategory(filteredSales, productById, generalLabel, filteredReturns),
    [filteredSales, productById, generalLabel, filteredReturns],
  );

  if (!canViewProfit) {
    return <Navigate to="/upgrade" replace />;
  }

  const { groups, total } = report;

  return (
    <div className={embedded ? "space-y-5" : "space-y-5 pb-12"}>
      {!embedded ? (
        <PageHeader
          lang={lang}
          title={t(lang, "profitPageTitle")}
          subtitle={t(lang, "profitPageSub")}
          backLabel={t(lang, "officeBackToHub")}
        />
      ) : null}

      <HistoryHeroCard
        lang={lang}
        filter={filter}
        onFilterChange={setFilter}
        metrics={[
          {
            label: t(lang, "profitPageTotalLabel"),
            icon: TrendingUp,
            value: `UGX ${total.profitUgx.toLocaleString()}`,
          },
          {
            label: t(lang, "homeProfitSalesLabel"),
            icon: Wallet,
            value: `UGX ${total.salesUgx.toLocaleString()}`,
          },
          {
            label: t(lang, "homeProfitCostLabel"),
            icon: TrendingDown,
            value: `UGX ${total.costUgx.toLocaleString()}`,
          },
        ]}
      />
      {archiveNotice ? (
        <DateFilterArchiveNotice
          lang={lang}
          archivedCount={archivedSalesCount}
          onEnableArchived={() => setIncludeArchived(true)}
        />
      ) : null}
      {needsArchive && includeArchived && archivedSalesCount > 0 ? (
        <p className="text-xs font-semibold text-stone-600">{t(lang, "dateFilterArchiveIncluded")}</p>
      ) : null}
      {needsArchive && archivedSalesCount === 0 ? (
        <p className="text-xs font-semibold text-amber-800">{t(lang, "dateFilterArchiveEmpty")}</p>
      ) : null}

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      {total.linesMissingCost > 0 ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
          {t(lang, "homeProfitMissingCost").replace("{{count}}", String(total.linesMissingCost))}{" "}
          <Link to="/stock" className="font-black text-waka-800 underline">
            {t(lang, "homeProfitAddCostCta")}
          </Link>
        </p>
      ) : null}

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
