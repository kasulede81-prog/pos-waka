import type { ReactNode } from "react";
import clsx from "clsx";
import type { Language, Product, Purchase, Supplier } from "../../../types";
import type { ShopReportBundle } from "../../../hooks/useShopReporting";
import type { InventoryInsights } from "../../../lib/localReporting";
import type { PaymentMixSlice, LeaderboardRow } from "../types";
import type { AnalyticsCategory } from "../types";
import { t } from "../../../lib/i18n";
import { KPI_VALUE_CLASS } from "../../../lib/desktopLayout";
import { formatShortUgx } from "../../../lib/commandCenterPageView";
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
  marginLeaders: Array<{ name: string; revenue: number; profit: number; pct: number }>;
  weakProducts: Array<{ name: string; revenueUgx: number }>;
  products: Product[];
  purchases: Purchase[];
  suppliers: Supplier[];
  modePanels: ReactNode;
  count: number;
  revenue: number;
  profit: number;
};

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="min-w-0 rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">{label}</p>
      <p className={clsx("mt-1 text-xl font-black text-stone-950", KPI_VALUE_CLASS)}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] font-semibold text-stone-500">{hint}</p> : null}
    </article>
  );
}

export function AnalyticsCategoryContent(props: AnalyticsSectionProps) {
  const { lang, category } = props;

  if (category === "overview") {
    if (props.count === 0 && props.revenue === 0) {
      return <AnalyticsEmptyState lang={lang} titleKey="baEmptyTitle" bodyKey="baEmptyBody" />;
    }
    return (
      <div className="space-y-4">
        {props.modePanels}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile label={t(lang, "baTodaySummary")} value={formatShortUgx(props.revenue)} hint={`${props.count} ${t(lang, "salesCount").toLowerCase()}`} />
          <StatTile label={t(lang, "baTopProduct")} value={props.topProducts[0]?.label ?? "—"} hint={props.topProducts[0]?.value} />
          <StatTile label={t(lang, "baBestCustomer")} value={props.topCustomers[0]?.label ?? "—"} hint={props.topCustomers[0]?.value} />
          <StatTile label={t(lang, "baActiveCashier")} value={props.topCashiers[0]?.label ?? "—"} hint={props.topCashiers[0]?.sub} />
          <StatTile label={t(lang, "reportsDebtOutstanding")} value={formatShortUgx(props.debtOutstanding)} />
          {props.canProfit ? (
            <StatTile label={t(lang, "estimatedProfit")} value={formatShortUgx(props.profit)} />
          ) : null}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <AnalyticsTrendChart points={props.sparkline} title={t(lang, "baSalesOverview")} />
          <AnalyticsDonutChart
            title={t(lang, "baPaymentMethods")}
            slices={props.paymentMix.map((s) => ({ label: t(lang, s.labelKey), pct: s.pct, colorClass: s.colorClass }))}
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <AnalyticsLeaderboard lang={lang} title={t(lang, "topProducts")} rows={props.topProducts} />
          <AnalyticsLeaderboard lang={lang} title={t(lang, "baTopCustomers")} rows={props.topCustomers} />
          <AnalyticsLeaderboard lang={lang} title={t(lang, "baTopEmployees")} rows={props.topCashiers} />
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
          <StatTile label={t(lang, "cashInHand")} value={formatShortUgx(props.report.cash)} />
        </div>
        <AnalyticsBarChart title={t(lang, "reportsWeekTrend")} bars={props.trendBars} />
        <AnalyticsDonutChart
          title={t(lang, "baPaymentMethods")}
          slices={props.paymentMix.map((s) => ({ label: t(lang, s.labelKey), pct: s.pct, colorClass: s.colorClass }))}
        />
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
        <ProfitPage lang={lang} embedded />
      </div>
    );
  }

  if (category === "products") {
    return (
      <div className="space-y-4">
        <AnalyticsLeaderboard lang={lang} title={t(lang, "topProducts")} rows={props.topProducts} />
        {props.canProfit && props.weakProducts.length > 0 ? (
          <AnalyticsLeaderboard
            lang={lang}
            title={t(lang, "reportsWeakSellers")}
            rows={props.weakProducts.map((p, i) => ({ id: `w-${i}`, label: p.name, value: formatShortUgx(p.revenueUgx) }))}
          />
        ) : null}
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-black text-stone-950">{t(lang, "stockRemainingHint")}</h3>
          <ul className="mt-3 space-y-2">
            {props.products.slice(0, 12).map((p) => (
              <li key={p.id} className="flex justify-between text-sm font-medium text-stone-700">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 tabular-nums">
                  {p.stockOnHand} {p.baseUnit}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  if (category === "inventory") {
    return (
      <div className="space-y-4">
        <StatTile label={t(lang, "reportsStockValue")} value={formatShortUgx(props.inventory.stockValueAtCostUgx)} />
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
        <AnalyticsLeaderboard lang={lang} title={t(lang, "baTopCustomers")} rows={props.topCustomers} />
        <StatTile label={t(lang, "baReturningCustomers")} value={String(props.topCustomers.filter((c) => c.sub?.includes("purchases")).length)} />
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
          emptyKey="baNoDebtCustomers"
        />
      </div>
    );
  }

  if (category === "expenses") {
    return (
      <div className="space-y-4">
        <StatTile label={t(lang, "cashExpensesToday")} value={formatShortUgx(props.expensesUgx)} hint={t(lang, "expensesFutureHint")} />
      </div>
    );
  }

  if (category === "purchases") {
    const purchaseTotal = props.purchases.reduce((a, p) => a + p.totalCostUgx, 0);
    return (
      <div className="space-y-4">
        <StatTile label={t(lang, "reportsPurchasesToday")} value={formatShortUgx(props.purchasesTodayUgx)} />
        <StatTile label={t(lang, "baPurchasesTotal")} value={formatShortUgx(purchaseTotal)} hint={`${props.suppliers.length} ${t(lang, "auditFilterSupplier").toLowerCase()}`} />
        <StatTile label={t(lang, "reportsSupplierDebt")} value={formatShortUgx(props.supplierDebtTotal)} />
      </div>
    );
  }

  if (category === "cash_flow") {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile label={t(lang, "baMoneyIn")} value={formatShortUgx(props.revenue)} />
          <StatTile label={t(lang, "baMoneyOut")} value={formatShortUgx(props.expensesUgx + props.purchasesTodayUgx)} />
          <StatTile label={t(lang, "baNetCashFlow")} value={formatShortUgx(props.report.cash - props.expensesUgx)} />
          <StatTile label={t(lang, "cashInHand")} value={formatShortUgx(props.report.cash)} />
        </div>
      </div>
    );
  }

  if (category === "employees") {
    return <AnalyticsLeaderboard lang={lang} title={t(lang, "baTopEmployees")} rows={props.topCashiers} />;
  }

  if (category === "taxes") {
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
