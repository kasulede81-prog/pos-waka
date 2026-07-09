import { useDeferredValue, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { BarChart3, FileDown, TrendingUp } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useReportingSales } from "../hooks/useReportingSales";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { returnMatchesFilter, saleMatchesFilter } from "../lib/dateFilters";
import { isCompletedSale } from "../lib/saleStatus";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import { computeProfitGroupedByCategory } from "../lib/homeProfit";
import { PageHeader } from "../components/layout/PageHeader";
import { DateFilterArchiveNotice } from "../components/shared/DateFilterArchiveNotice";
import { MONTH_TO_DATE_FILTER } from "../lib/dateFilters";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import { SalesHistoryDateFilterChips } from "../components/receipts/SalesHistoryDateFilterChips";
import { ProfitStatGrid } from "../components/profit/ProfitStatGrid";
import { ProfitTrendChart } from "../components/profit/ProfitTrendChart";
import { ProfitShelfRanking } from "../components/profit/ProfitShelfRanking";
import { ProfitProductCard } from "../components/profit/ProfitProductCard";
import { ProfitLowMarginList } from "../components/profit/ProfitLowMarginList";
import { ProfitSearchBar } from "../components/profit/ProfitSearchBar";
import { ProfitQuickFilterChips } from "../components/profit/ProfitQuickFilterChips";
import { ProfitProductDetailSheet } from "../components/profit/ProfitProductDetailSheet";
import { ProfitInsightsPanel } from "../components/profit/ProfitInsightsPanel";
import { ProfitSkeletonList, ProfitStatGridSkeleton } from "../components/profit/ProfitSkeleton";
import {
  computeDailyProfitTrend,
  flattenProfitProducts,
  lastSoldAtForProduct,
  marginPercent,
  matchesProfitSearch,
  matchesShelfSearch,
  type ProfitProductView,
  type ProfitQuickFilter,
} from "../lib/profitPageView";
import { selectedDayKeyForFilter } from "../lib/dateFilterLabels";
import { buildDailyReportText, shareText } from "../lib/reportExport";

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
  } = useReportingDateFilter(MONTH_TO_DATE_FILTER);
  const rawSales = useReportingSales(includeArchived);
  const sales = useDeferredValue(rawSales);
  const salesRefreshing = rawSales !== sales;
  const returnRecords = usePosStore((s) => s.returnRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);
  const products = usePosStore((s) => s.products);
  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<ProfitQuickFilter>("all");
  const [detailProduct, setDetailProduct] = useState<ProfitProductView | null>(null);

  const { canProfit: canViewProfit } = resolveProfitVisibility({ role: actor.role, snapshot, authMode, actorPermissions: actor.permissions });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const generalLabel = t(lang, "uncategorized");
  const locale = lang === "sw" ? "sw-UG" : "en-UG";

  const filteredSales = useMemo(
    () => sales.filter((s) => isCompletedSale(s) && saleMatchesFilter(s, bounds)),
    [sales, bounds],
  );

  const filteredReturns = useMemo(() => {
    const allReturnRecords = includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords;
    return allReturnRecords.filter((r) => returnMatchesFilter(r, bounds));
  }, [includeArchived, returnRecords, archivedReturnRecords, bounds]);

  const report = useMemo(
    () => computeProfitGroupedByCategory(filteredSales, productById, generalLabel, filteredReturns),
    [filteredSales, productById, generalLabel, filteredReturns],
  );

  const { groups, total } = report;
  const marginPct = marginPercent(total.salesUgx, total.profitUgx);
  const allProducts = useMemo(() => flattenProfitProducts(groups), [groups]);
  const bestShelf = groups[0]?.categoryLabel ?? null;
  const bestProduct = allProducts[0]?.name ?? null;

  const dailyTrend = useMemo(
    () => computeDailyProfitTrend(filteredSales, filteredReturns, productById, locale),
    [filteredSales, filteredReturns, productById, locale],
  );

  const searchedProducts = useMemo(() => {
    return allProducts.filter((p) => matchesProfitSearch(searchQuery, p, productById.get(p.productId)));
  }, [allProducts, searchQuery, productById]);

  const searchedGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    return groups.filter((g) => matchesShelfSearch(searchQuery, g.categoryLabel));
  }, [groups, searchQuery]);

  const displayProducts = useMemo(() => {
    let list = [...searchedProducts];
    if (quickFilter === "highest_profit") list.sort((a, b) => b.profitUgx - a.profitUgx);
    else if (quickFilter === "lowest_profit") list.sort((a, b) => a.profitUgx - b.profitUgx);
    else if (quickFilter === "loss_making") list = list.filter((p) => p.profitUgx < 0);
    return list;
  }, [searchedProducts, quickFilter]);

  const showShelves = quickFilter === "all" || quickFilter === "shelves";
  const showProducts = quickFilter === "all" || quickFilter === "products" || quickFilter === "highest_profit" || quickFilter === "lowest_profit" || quickFilter === "loss_making";
  const showLowMargin = quickFilter === "all" || quickFilter === "loss_making";

  const totalUnitsSold = useMemo(() => allProducts.reduce((sum, p) => sum + p.qty, 0), [allProducts]);
  const avgProfitPerSale = filteredSales.length > 0 ? Math.round(total.profitUgx / filteredSales.length) : 0;

  const insights = useMemo(() => {
    const items: { text: string }[] = [];
    if (bestShelf) {
      items.push({ text: tTemplate(lang, "profitInsightBestShelf", { name: bestShelf }) });
    }
    if (bestProduct) {
      items.push({ text: tTemplate(lang, "profitInsightBestProduct", { name: bestProduct }) });
    }
    const highestMargin = [...allProducts].sort((a, b) => b.marginPct - a.marginPct)[0];
    if (highestMargin && highestMargin.salesUgx > 0) {
      items.push({
        text: tTemplate(lang, "profitInsightHighestMargin", {
          name: highestMargin.name,
          margin: highestMargin.marginPct.toFixed(1),
        }),
      });
    }
    const lowestMargin = [...allProducts].filter((p) => p.salesUgx > 0).sort((a, b) => a.marginPct - b.marginPct)[0];
    if (lowestMargin) {
      items.push({
        text: tTemplate(lang, "profitInsightLowestMargin", {
          name: lowestMargin.name,
          margin: lowestMargin.marginPct.toFixed(1),
        }),
      });
    }
    const belowCost = allProducts.filter((p) => p.profitUgx < 0);
    if (belowCost.length > 0) {
      items.push({ text: tTemplate(lang, "profitInsightBelowCost", { count: String(belowCost.length) }) });
    }
    if (avgProfitPerSale !== 0) {
      items.push({ text: tTemplate(lang, "profitInsightAvgProfit", { amount: avgProfitPerSale.toLocaleString() }) });
    }
    if (totalUnitsSold > 0) {
      items.push({ text: tTemplate(lang, "profitInsightUnitsSold", { count: totalUnitsSold.toLocaleString() }) });
    }
    return items;
  }, [lang, bestShelf, bestProduct, allProducts, avgProfitPerSale, totalUnitsSold]);

  const detailLastSold = detailProduct ? lastSoldAtForProduct(filteredSales, detailProduct.productId) : null;
  const detailRecord = detailProduct ? productById.get(detailProduct.productId) : undefined;

  if (!canViewProfit) {
    return <Navigate to="/upgrade" replace />;
  }

  const exportReport = async () => {
    const dayKey = selectedDayKeyForFilter(filter);
    if (dayKey) {
      const body = buildDailyReportText(lang, dayKey, {
        sales: filteredSales,
        products,
        returnRecords: filteredReturns,
        includeProfit: true,
      });
      await shareText(body, t(lang, "profitPageTitle"));
      return;
    }
    const lines = [
      t(lang, "profitPageTitle"),
      `${t(lang, "profitStatNetProfit")}: UGX ${total.profitUgx.toLocaleString()}`,
      `${t(lang, "profitStatRevenue")}: UGX ${total.salesUgx.toLocaleString()}`,
      `${t(lang, "profitStatCost")}: UGX ${total.costUgx.toLocaleString()}`,
      `${t(lang, "profitStatMargin")}: ${marginPct.toFixed(1)}%`,
      "",
      ...groups.flatMap((g) => [
        `${g.categoryLabel}: UGX ${g.profitUgx.toLocaleString()}`,
        ...g.products.map((p) => `  ${p.name}: UGX ${p.profitUgx.toLocaleString()}`),
      ]),
    ];
    await shareText(lines.join("\n"), t(lang, "profitPageTitle"));
  };

  const hasData = filteredSales.length > 0 || groups.length > 0;

  return (
    <div className={embedded ? "space-y-3" : "space-y-3 pb-12"}>
      {!embedded ? (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <PageHeader
              lang={lang}
              title={t(lang, "profitPageTitleAnalytics")}
              subtitle={t(lang, "profitPageSubAnalytics")}
              backLabel={t(lang, "officeBackToHub")}
              showBack
              compact
            />
          </div>
          <div className="flex shrink-0 items-center gap-1.5 pt-8">
            {hasData ? (
              <button
                type="button"
                onClick={() => void exportReport()}
                className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-xl border border-stone-200 bg-white px-2.5 text-xs font-bold text-waka-700 shadow-sm active:bg-stone-50"
              >
                <FileDown className="h-4 w-4 shrink-0" aria-hidden />
                <span className="hidden sm:inline">{t(lang, "salesHistoryExport")}</span>
              </button>
            ) : null}
            <Link
              to="/reports?tab=profit"
              className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-xl border border-stone-200 bg-white px-2.5 text-xs font-bold text-stone-700 shadow-sm active:bg-stone-50"
            >
              <BarChart3 className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden sm:inline">{t(lang, "profitInsightsLink")}</span>
            </Link>
          </div>
        </div>
      ) : null}

      {salesRefreshing ? (
        <ProfitStatGridSkeleton />
      ) : hasData ? (
        <ProfitStatGrid
          lang={lang}
          netProfitUgx={total.profitUgx}
          revenueUgx={total.salesUgx}
          costUgx={total.costUgx}
          marginPct={marginPct}
          bestShelf={bestShelf}
          bestProduct={bestProduct}
        />
      ) : null}

      {hasData ? (
        <div className="sticky top-0 z-10 -mx-3 space-y-2 bg-stone-50/95 px-3 pb-2 pt-0 backdrop-blur-sm sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
          <SalesHistoryDateFilterChips lang={lang} filter={filter} onFilterChange={setFilter} />
          <ProfitQuickFilterChips lang={lang} active={quickFilter} onChange={setQuickFilter} />
          <ProfitSearchBar lang={lang} value={searchQuery} onChange={setSearchQuery} />
        </div>
      ) : (
        <SalesHistoryDateFilterChips lang={lang} filter={filter} onFilterChange={setFilter} />
      )}

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

      {!hasData && !salesRefreshing ? (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white px-6 py-12 text-center">
          <TrendingUp className="mx-auto h-8 w-8 text-stone-300" aria-hidden />
          <p className="mt-3 text-base font-black text-stone-800">{t(lang, "profitEmptyTitle")}</p>
          <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "profitEmptyHint")}</p>
        </div>
      ) : null}

      {salesRefreshing ? (
        <ProfitSkeletonList />
      ) : hasData ? (
        <div className="space-y-3 transition-opacity duration-300">
          {dailyTrend.length >= 2 ? <ProfitTrendChart lang={lang} points={dailyTrend} /> : null}

          {insights.length > 0 ? <ProfitInsightsPanel lang={lang} insights={insights} /> : null}

          {showShelves && searchedGroups.length > 0 ? (
            <ProfitShelfRanking
              lang={lang}
              groups={searchedGroups}
              totalProfitUgx={total.profitUgx}
              onShelfClick={(label) => setSearchQuery(label)}
            />
          ) : null}

          {showProducts && displayProducts.length > 0 ? (
            <section className="space-y-2">
              <h3 className="px-0.5 text-xs font-black text-stone-800">{t(lang, "profitTopProducts")}</h3>
              {displayProducts.map((p) => (
                <ProfitProductCard key={`${p.productId}-${p.name}`} lang={lang} product={p} onOpen={setDetailProduct} />
              ))}
            </section>
          ) : null}

          {showLowMargin ? (
            <ProfitLowMarginList lang={lang} products={searchedProducts} onProductClick={setDetailProduct} />
          ) : null}

          {hasData && displayProducts.length === 0 && searchedGroups.length === 0 && searchQuery.trim() ? (
            <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm font-bold text-stone-600">
              {t(lang, "posSellNoMatch")}
            </p>
          ) : null}
        </div>
      ) : null}

      <ProfitProductDetailSheet
        lang={lang}
        open={detailProduct !== null}
        product={detailProduct}
        productRecord={detailRecord}
        lastSoldAt={detailLastSold}
        onClose={() => setDetailProduct(null)}
      />
    </div>
  );
}
