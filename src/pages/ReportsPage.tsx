import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useShopReportBundle } from "../hooks/useShopReporting";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { dateKeyKampala } from "../lib/datesUg";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { useSubscription } from "../context/SubscriptionContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { buildDailyReportText, shareText } from "../lib/reportExport";
import { PageHeader } from "../components/layout/PageHeader";

type Range = "today" | "week" | "month";

export function ReportsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const returnRecords = usePosStore((s) => s.returnRecords);
  const products = usePosStore((s) => s.products);
  const purchases = usePosStore((s) => s.purchases);
  const [range, setRange] = useState<Range>("today");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [reportHint, setReportHint] = useState<string | null>(null);
  const sales = useDeferredReportingSales(includeArchived);
  const report = useShopReportBundle(range, includeArchived);

  if (!hasPermission(actor.role, "reports.view")) {
    return <Navigate to="/" replace />;
  }

  const canProfit = hasEffectivePermission(actor.role, "reports.profit", snapshot, authMode);
  const canPurchasesView = hasPermission(actor.role, "purchases.view");
  const canSuppliersView = hasPermission(actor.role, "suppliers.view");

  const purchasesTodayUgx = useMemo(() => {
    const dk = dateKeyKampala(new Date());
    return purchases.filter((p) => dateKeyKampala(p.createdAt) === dk).reduce((a, p) => a + p.totalCostUgx, 0);
  }, [purchases]);

  const totals = { cash: report.cash, profit: report.profit, debt: report.debt, count: report.count };
  const topProducts = report.topProducts;
  const weakProducts = report.slowProducts;
  const last7DayBars = report.dailyTrend;
  const debtOutstanding = report.debtOutstanding;
  const supplierDebtTotal = report.supplierDebtTotal;
  const stockValueAtCost = report.stockValueAtCost;
  const marginLeaders = report.marginLeaders.map((r) => ({
    name: r.name,
    revenue: r.revenueUgx,
    profit: r.profitUgx,
    pct: r.revenueUgx > 0 ? r.profitUgx / r.revenueUgx : 0,
  }));

  return (
    <div className="space-y-5 pb-8">
      <PageHeader lang={lang} title={t(lang, "reports")} backLabel={t(lang, "officeBackToHub")} />

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      <div className="flex gap-2">
        {(["today", "week", "month"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`flex-1 rounded-2xl py-3 text-sm font-bold ${
              range === r ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
            }`}
          >
            {t(lang, `range_${r}`)}
          </button>
        ))}
      </div>

      {range === "today" ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">{t(lang, "exportReportHeading")}</p>
          {reportHint ? <p className="mt-2 text-sm text-slate-600">{reportHint}</p> : null}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white"
              onClick={() => {
                const dk = dateKeyKampala(new Date());
                const text = buildDailyReportText(lang, dk, sales, products, returnRecords);
                void navigator.clipboard.writeText(text).then(
                  () => {
                    setReportHint(t(lang, "reportCopied"));
                    window.setTimeout(() => setReportHint(null), 3500);
                  },
                  () => setReportHint(t(lang, "reportCopyInstead")),
                );
              }}
            >
              {t(lang, "reportCopyDay")}
            </button>
            <button
              type="button"
              className="rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800"
              onClick={async () => {
                const dk = dateKeyKampala(new Date());
                const text = buildDailyReportText(lang, dk, sales, products, returnRecords);
                const ok = await shareText(text, t(lang, "appName"));
                setReportHint(ok ? t(lang, "reportShared") : t(lang, "reportCopyInstead"));
                window.setTimeout(() => setReportHint(null), 3500);
              }}
            >
              {t(lang, "reportShareDay")}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">{t(lang, "exportReportFooter")}</p>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-3xl border bg-white p-4">
          <p className="text-xs text-slate-500">{t(lang, "cashInHand")}</p>
          <p className="text-2xl font-bold">UGX {totals.cash.toLocaleString()}</p>
        </article>
        {canProfit ? (
          <article className="rounded-3xl border bg-white p-4">
            <p className="text-xs text-slate-500">{t(lang, "estimatedProfit")}</p>
            <p
              className={`text-2xl font-bold ${totals.profit < 0 ? "text-slate-600" : "text-waka-700"}`}
            >
              UGX {totals.profit.toLocaleString()}
            </p>
            <p className="mt-2 text-xs text-slate-500">{t(lang, "estimatedProfitHint")}</p>
          </article>
        ) : null}
        <article className="rounded-3xl border bg-white p-4">
          <p className="text-xs text-slate-500">{t(lang, "debtToday")}</p>
          <p className="text-2xl font-bold text-amber-800">UGX {totals.debt.toLocaleString()}</p>
        </article>
        <article className="rounded-3xl border bg-white p-4">
          <p className="text-xs text-slate-500">{t(lang, "salesCount")}</p>
          <p className="text-2xl font-bold">{totals.count}</p>
        </article>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-800">{t(lang, "reportsWeekTrend")}</p>
        <div className="mt-4 flex h-28 items-end justify-between gap-1 px-1">
          {last7DayBars.map((b) => (
            <div key={b.day} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div
                className="w-full max-w-[2.25rem] rounded-t-lg bg-gradient-to-t from-slate-800 to-slate-600"
                style={{ height: b.barPx }}
                title={`UGX ${b.total.toLocaleString()}`}
              />
              <span className="text-[10px] font-bold text-slate-500">{b.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border bg-amber-50/50 p-4 ring-1 ring-amber-100">
        <p className="text-sm font-semibold text-amber-950">{t(lang, "reportsDebtOutstanding")}</p>
        <p className="mt-1 text-2xl font-black text-amber-900">UGX {debtOutstanding.toLocaleString()}</p>
      </section>

      {canPurchasesView || canSuppliersView || canProfit ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {canPurchasesView ? (
            <article className="rounded-3xl border border-waka-100 bg-waka-50/40 p-4">
              <p className="text-xs font-semibold text-waka-900">{t(lang, "reportsPurchasesToday")}</p>
              <p className="mt-1 text-2xl font-black text-waka-950">UGX {purchasesTodayUgx.toLocaleString()}</p>
            </article>
          ) : null}
          {canSuppliersView ? (
            <article className="rounded-3xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">{t(lang, "reportsSupplierDebt")}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">UGX {supplierDebtTotal.toLocaleString()}</p>
            </article>
          ) : null}
          {canProfit ? (
            <article className="rounded-3xl border border-slate-200 bg-white p-4 sm:col-span-2">
              <p className="text-xs text-slate-500">{t(lang, "reportsStockValue")}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">UGX {stockValueAtCost.toLocaleString()}</p>
            </article>
          ) : null}
        </section>
      ) : null}

      {canProfit && marginLeaders.length > 0 ? (
        <section className="rounded-3xl border bg-white p-4">
          <p className="font-semibold text-slate-800">{t(lang, "reportsBestMargins")}</p>
          <p className="mt-1 text-xs text-slate-500">{t(lang, "reportsMarginHint")}</p>
          <ul className="mt-3 space-y-2">
            {marginLeaders.map((r) => (
              <li key={r.name} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{r.name}</span>
                <span className="text-waka-700">
                  UGX {r.profit.toLocaleString()}
                  <span className="text-slate-500"> ({Math.round(r.pct * 100)}%)</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canProfit ? (
        <section className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">{t(lang, "expensesFutureTitle")}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{t(lang, "expensesFutureHint")}</p>
        </section>
      ) : null}

      <section className="rounded-3xl border bg-white p-4">
        <p className="font-semibold text-slate-800">{t(lang, "topProducts")}</p>
        {topProducts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">{t(lang, "noSalesYet")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {topProducts.map((p) => (
              <li key={p.productId || p.name} className="flex justify-between text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="text-slate-600">UGX {p.revenueUgx.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canProfit && weakProducts.length > 0 ? (
        <section className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold text-slate-800">{t(lang, "reportsWeakSellers")}</p>
          <ul className="mt-3 space-y-2">
            {weakProducts.map((p) => (
              <li key={p.productId || p.name} className="flex justify-between text-sm">
                <span className="font-medium text-slate-700">{p.name}</span>
                <span className="text-slate-500">UGX {p.revenueUgx.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-3xl border bg-slate-50 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-800">{t(lang, "stockRemainingHint")}</p>
        <ul className="mt-2 space-y-1">
          {products.slice(0, 12).map((p) => (
            <li key={p.id} className="flex justify-between">
              <span>{p.name}</span>
              <span>
                {p.stockOnHand} {p.baseUnit}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
