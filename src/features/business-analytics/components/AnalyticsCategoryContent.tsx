import type { ReactNode } from "react";
import clsx from "clsx";
import { Link } from "react-router-dom";
import type { Language, Product, Purchase, Supplier } from "../../../types";
import type { ShopReportBundle } from "../../../hooks/useShopReporting";
import type { ReportsPeriodCashFlow } from "../../../lib/reportsCashFlow";
import type { InventoryInsights } from "../../../lib/localReporting";
import type { PaymentMixSlice, LeaderboardRow } from "../types";
import type { AnalyticsCategory } from "../types";
import type { DateFilterValue } from "../../../lib/dateFilters";
import { t } from "../../../lib/i18n";
import {
  REPORTS_STOCK_NOW_HREF,
  reportsStockNowHeading,
  reportsStockNowPreview,
  reportsStockNowRowFields,
} from "../lib/reportsStockNowPreview";
import { KPI_VALUE_CLASS } from "../../../lib/desktopLayout";
import { formatShortUgx } from "../../../lib/commandCenterPageView";
import { reportsInventoryCostPresentation } from "../lib/analyticsPageView";
import { formatDateFilterViewingLabel } from "../../../lib/dateFilterLabels";
import { reportsCategoryBlocksOnIncompleteSales } from "../../../lib/reportsDataCompleteness";
import { AnalyticsBarChart, AnalyticsDonutChart, AnalyticsTrendChart } from "./AnalyticsCharts";
import { AnalyticsLeaderboard, AnalyticsEmptyState } from "./AnalyticsLeaderboard";
import { MonthlyReportsPanel } from "../../../components/reports/MonthlyReportsPanel";
import { ProfitPage } from "../../../pages/ProfitPage";

export type AnalyticsSectionProps = {
  lang: Language;
  category: AnalyticsCategory;
  report: ShopReportBundle;
  canProfit: boolean;
  paymentMix: PaymentMixSlice[];
  trendBars: { label: string; total: number; barPx: number }[];
  sparkline: { value: number }[];
  topProducts: LeaderboardRow[];
  topCustomers: LeaderboardRow[];
  topCashiers: LeaderboardRow[];
  inventory: InventoryInsights;
  expensesUgx: number;
  debtOutstanding: number;
  supplierDebtTotal: number;
  stockValueAtCost: number;
  purchasesTodayUgx: number;
  purchasesInPeriodUgx: number;
  cashFlow: ReportsPeriodCashFlow;
  marginLeaders: Array<{ name: string; revenue: number; profit: number; pct: number }>;
  weakProducts: Array<{ name: string; revenueUgx: number }>;
  products: Product[];
  purchases: Purchase[];
  suppliers: Supplier[];
  modePanels: ReactNode;
  count: number;
  revenue: number;
  profit: number;
  dateFilter?: DateFilterValue;
  includeArchived?: boolean;
};

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="min-w-0 rounded-2xl border border-border/90 bg-card p-4 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={clsx("mt-1 text-xl font-black text-foreground", KPI_VALUE_CLASS)}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] font-semibold text-muted-foreground">{hint}</p> : null}
    </article>
  );
}

function closedBreakdownEmpty(unavailable: boolean) {
  return unavailable
    ? {
        emptyKey: "reportsClosedBreakdownUnavailable",
        emptyHintKey: "reportsClosedBreakdownUnavailableHint",
      }
    : {};
}

function ReportsDataLoadingState({ lang }: { lang: Language }) {
  return <AnalyticsEmptyState lang={lang} titleKey="salesHistoryHydrationLoading" bodyKey="baReportDataPreparing" />;
}

export function AnalyticsCategoryContent(props: AnalyticsSectionProps) {
  const { lang, category } = props;
  const breakdownsUnavailable = props.report.closedDayBreakdownUnavailable;
  const closedEmpty = closedBreakdownEmpty(breakdownsUnavailable);
  const remainderPending = !props.report.remainderReady;
  const liveFinancialsPending = props.report.loading;
  const hideEmbeddedProfitPage = !props.report.dataComplete;

  if (liveFinancialsPending && reportsCategoryBlocksOnIncompleteSales(category)) {
    if (category === "expenses" || category === "purchases") {
      if (remainderPending) return <ReportsDataLoadingState lang={lang} />;
    } else {
      return <ReportsDataLoadingState lang={lang} />;
    }
  }
  if ((category === "expenses" || category === "purchases") && remainderPending) {
    return <ReportsDataLoadingState lang={lang} />;
  }
  if ((category === "taxes" || category === "performance") && !props.report.dataComplete) {
    return <ReportsDataLoadingState lang={lang} />;
  }

  if (category === "overview") {
    if (liveFinancialsPending) {
      return <ReportsDataLoadingState lang={lang} />;
    }
    if (props.count === 0 && props.revenue === 0 && !breakdownsUnavailable && props.report.dataComplete) {
      return <AnalyticsEmptyState lang={lang} titleKey="baEmptyTitle" bodyKey="baEmptyBody" />;
    }
    return (
      <div className="space-y-4">
        {props.modePanels}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile label={t(lang, "baTodaySummary")} value={formatShortUgx(props.revenue)} hint={`${props.count} ${t(lang, "salesCount").toLowerCase()}`} />
          <StatTile
            label={t(lang, "baTopProduct")}
            value={breakdownsUnavailable ? t(lang, "reportsClosedBreakdownUnavailable") : (props.topProducts[0]?.label ?? "—")}
            hint={breakdownsUnavailable ? t(lang, "reportsClosedBreakdownUnavailableHint") : props.topProducts[0]?.value}
          />
          <StatTile
            label={t(lang, "baBestCustomer")}
            value={breakdownsUnavailable ? t(lang, "reportsClosedBreakdownUnavailable") : (props.topCustomers[0]?.label ?? "—")}
            hint={breakdownsUnavailable ? t(lang, "reportsClosedBreakdownUnavailableHint") : props.topCustomers[0]?.value}
          />
          <StatTile
            label={t(lang, "baActiveCashier")}
            value={breakdownsUnavailable ? t(lang, "reportsClosedBreakdownUnavailable") : (props.topCashiers[0]?.label ?? "—")}
            hint={breakdownsUnavailable ? t(lang, "reportsClosedBreakdownUnavailableHint") : props.topCashiers[0]?.sub}
          />
          <StatTile label={t(lang, "reportsDebtOutstanding")} value={formatShortUgx(props.debtOutstanding)} />
          {props.canProfit ? (
            <StatTile label={t(lang, "estimatedProfit")} value={formatShortUgx(props.profit)} />
          ) : null}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {breakdownsUnavailable ? (
            <AnalyticsEmptyState lang={lang} titleKey="reportsClosedBreakdownUnavailable" bodyKey="reportsClosedBreakdownUnavailableHint" />
          ) : (
            <AnalyticsTrendChart points={props.sparkline} title={t(lang, "baSalesOverview")} />
          )}
          {breakdownsUnavailable ? (
            <AnalyticsEmptyState lang={lang} titleKey="reportsClosedBreakdownUnavailable" bodyKey="reportsClosedBreakdownUnavailableHint" />
          ) : (
            <AnalyticsDonutChart
              title={t(lang, "baPaymentMethods")}
              slices={props.paymentMix.map((s) => ({ label: t(lang, s.labelKey), pct: s.pct, colorClass: s.colorClass }))}
            />
          )}
        </div>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <AnalyticsLeaderboard lang={lang} title={t(lang, "topProducts")} rows={props.topProducts} {...closedEmpty} />
          <AnalyticsLeaderboard lang={lang} title={t(lang, "baTopCustomers")} rows={props.topCustomers} {...closedEmpty} />
          <AnalyticsLeaderboard lang={lang} title={t(lang, "baTopEmployees")} rows={props.topCashiers} {...closedEmpty} />
          {props.canProfit ? (
            <AnalyticsLeaderboard
              lang={lang}
              title={t(lang, "reportsBestMargins")}
              rows={props.marginLeaders.map((r, i) => ({
                id: `m-${i}`,
                label: r.name,
                value: formatShortUgx(r.profit),
                sub: `${Math.round(r.pct * 100)}%`,
              }))}
              {...closedEmpty}
            />
          ) : null}
        </div>
      </div>
    );
  }

  if (category === "sales") {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label={t(lang, "receiptsRangeRevenue")} value={formatShortUgx(props.revenue)} />
          <StatTile label={t(lang, "salesCount")} value={String(props.count)} />
          <StatTile
            label={t(lang, "cashInHand")}
            value={
              props.report.physicalCashUnavailable
                ? t(lang, "reportsClosedBreakdownUnavailable")
                : formatShortUgx(props.report.cash)
            }
            hint={props.report.physicalCashUnavailable ? t(lang, "reportsClosedPhysicalCashUnavailableHint") : undefined}
          />
        </div>
        <AnalyticsBarChart
          title={
            props.dateFilter ? formatDateFilterViewingLabel(lang, props.dateFilter) : t(lang, "reportsSalesTrend")
          }
          bars={props.trendBars}
        />
        {breakdownsUnavailable ? (
          <AnalyticsEmptyState lang={lang} titleKey="reportsClosedBreakdownUnavailable" bodyKey="reportsClosedBreakdownUnavailableHint" />
        ) : (
          <AnalyticsDonutChart
            title={t(lang, "baPaymentMethods")}
            slices={props.paymentMix.map((s) => ({ label: t(lang, s.labelKey), pct: s.pct, colorClass: s.colorClass }))}
          />
        )}
      </div>
    );
  }

  if (category === "profit") {
    if (!props.canProfit) return <AnalyticsEmptyState lang={lang} titleKey="baProfitLockedTitle" bodyKey="baProfitLockedBody" />;
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label={t(lang, "estimatedProfit")} value={formatShortUgx(props.profit)} />
          <StatTile label={t(lang, "reportsStockValue")} value={formatShortUgx(props.stockValueAtCost)} />
          <StatTile label={t(lang, "reportsSupplierDebt")} value={formatShortUgx(props.supplierDebtTotal)} />
        </div>
        {hideEmbeddedProfitPage ? (
          <ReportsDataLoadingState lang={lang} />
        ) : (
          <ProfitPage
            lang={lang}
            embedded
            dateFilter={props.dateFilter}
            includeArchived={props.includeArchived}
          />
        )}
      </div>
    );
  }

  if (category === "products") {
    const stockNow = reportsStockNowPreview(props.products);
    return (
      <div className="space-y-4">
        <AnalyticsLeaderboard lang={lang} title={t(lang, "topProducts")} rows={props.topProducts} {...closedEmpty} />
        {props.canProfit && props.weakProducts.length > 0 ? (
          <AnalyticsLeaderboard
            lang={lang}
            title={t(lang, "reportsWeakSellers")}
            rows={props.weakProducts.map((p, i) => ({ id: `w-${i}`, label: p.name, value: formatShortUgx(p.revenueUgx) }))}
            {...closedEmpty}
          />
        ) : null}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-black text-foreground">
            {reportsStockNowHeading(lang, stockNow.shown, stockNow.total)}
          </h3>
          <ul className="mt-3 space-y-2">
            {stockNow.rows.map((p) => {
              const row = reportsStockNowRowFields(p);
              return (
                <li key={p.id} className="flex justify-between text-sm font-medium text-muted-foreground">
                  <span className="truncate">{row.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {row.stockOnHand} {row.baseUnit}
                  </span>
                </li>
              );
            })}
          </ul>
          {stockNow.showViewStock ? (
            <Link to={REPORTS_STOCK_NOW_HREF} className="mt-3 inline-block text-sm font-black text-waka-800">
              {t(lang, "reportsViewStock")}
            </Link>
          ) : null}
        </section>
      </div>
    );
  }

  if (category === "inventory") {
    const inventoryCost = reportsInventoryCostPresentation(props.canProfit, props.inventory.stockValueAtCostUgx);
    return (
      <div className="space-y-4">
        <StatTile
          label={t(lang, "reportsStockValue")}
          value={inventoryCost.visible ? formatShortUgx(inventoryCost.valueUgx) : t(lang, "baProfitLockedTitle")}
          hint={inventoryCost.visible ? undefined : t(lang, "baProfitLockedBody")}
        />
        <AnalyticsLeaderboard
          lang={lang}
          title={t(lang, "baLowStock")}
          rows={props.inventory.lowStock.map((p) => ({
            id: p.productId,
            label: p.name,
            value: String(p.stockOnHand),
            sub: `Min ${p.minimumStockAlert}`,
          }))}
          emptyKey="baNoLowStock"
        />
        <AnalyticsLeaderboard
          lang={lang}
          title={t(lang, "baOutOfStock")}
          rows={props.inventory.outOfStock.map((p) => ({ id: p.productId, label: p.name, value: "0" }))}
          emptyKey="baNoOutOfStock"
        />
      </div>
    );
  }

  if (category === "customers") {
    return (
      <div className="space-y-4">
        <AnalyticsLeaderboard lang={lang} title={t(lang, "baTopCustomers")} rows={props.topCustomers} {...closedEmpty} />
        <StatTile
          label={t(lang, "baReturningCustomers")}
          value={
            breakdownsUnavailable
              ? t(lang, "reportsClosedBreakdownUnavailable")
              : String(props.topCustomers.filter((c) => c.sub?.includes("purchases")).length)
          }
        />
      </div>
    );
  }

  if (category === "debts") {
    return (
      <div className="space-y-4">
        <StatTile label={t(lang, "reportsDebtOutstanding")} value={formatShortUgx(props.debtOutstanding)} />
        <AnalyticsLeaderboard
          lang={lang}
          title={t(lang, "baCustomersWithDebt")}
          rows={props.topCustomers.filter((c) => c.sub?.includes("Debt"))}
          emptyKey={breakdownsUnavailable ? "reportsClosedBreakdownUnavailable" : "baNoDebtCustomers"}
          emptyHintKey={breakdownsUnavailable ? "reportsClosedBreakdownUnavailableHint" : undefined}
        />
      </div>
    );
  }

  if (category === "expenses") {
    return (
      <div className="space-y-4">
        <StatTile label={t(lang, "baExpensesInPeriod")} value={formatShortUgx(props.expensesUgx)} hint={t(lang, "expensesFutureHint")} />
      </div>
    );
  }

  if (category === "purchases") {
    return (
      <div className="space-y-4">
        <StatTile label={t(lang, "baPurchasesInPeriod")} value={formatShortUgx(props.purchasesInPeriodUgx)} />
        <StatTile label={t(lang, "reportsSupplierDebt")} value={formatShortUgx(props.supplierDebtTotal)} hint={`${props.suppliers.length} ${t(lang, "auditFilterSupplier").toLowerCase()}`} />
      </div>
    );
  }

  if (category === "cash_flow") {
    return (
      <div className="space-y-4">
        {props.cashFlow.unavailable ? (
          <AnalyticsEmptyState
            lang={lang}
            titleKey="reportsClosedBreakdownUnavailable"
            bodyKey="reportsClosedBreakdownUnavailableHint"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label={t(lang, "eodSummaryCashIn")}
              value={formatShortUgx(props.cashFlow.cashInUgx)}
              hint={t(lang, "baCashFlowPhysicalHint")}
            />
            <StatTile
              label={t(lang, "eodSummaryCashOut")}
              value={formatShortUgx(props.cashFlow.cashOutUgx)}
              hint={t(lang, "baCashFlowPhysicalHint")}
            />
            <StatTile label={t(lang, "baNetCashFlow")} value={formatShortUgx(props.cashFlow.netUgx)} />
          </div>
        )}
        <StatTile
          label={t(lang, "cashInHand")}
          value={
            props.report.physicalCashUnavailable
              ? t(lang, "reportsClosedBreakdownUnavailable")
              : formatShortUgx(props.report.cash)
          }
          hint={props.report.physicalCashUnavailable ? t(lang, "reportsClosedPhysicalCashUnavailableHint") : undefined}
        />
      </div>
    );
  }

  if (category === "employees") {
    return <AnalyticsLeaderboard lang={lang} title={t(lang, "baTopEmployees")} rows={props.topCashiers} {...closedEmpty} />;
  }

  if (category === "taxes") {
    const taxesConfigured = (props.report.taxesUgx ?? 0) > 0;
    if (!taxesConfigured) {
      return (
        <AnalyticsEmptyState lang={lang} titleKey="baTaxesCollected" bodyKey="baTaxNotConfigured" />
      );
    }
    return (
      <StatTile label={t(lang, "baTaxesCollected")} value={formatShortUgx(props.report.taxesUgx ?? 0)} hint={t(lang, "baTaxesHint")} />
    );
  }

  if (category === "performance") {
    return <MonthlyReportsPanel lang={lang} />;
  }

  if (category === "forecast") {
    return <AnalyticsEmptyState lang={lang} titleKey="baForecastTitle" bodyKey="baForecastBody" />;
  }

  return null;
}
