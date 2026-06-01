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
import { computeHospitalityReports } from "../lib/hospitalityReports";
import { isHospitalityMode } from "../lib/hospitality";
import { computePharmacyExpiryReport } from "../lib/pharmacyReports";
import { isPharmacyMode } from "../lib/pharmacy";
import { formatMedicineFullLabel } from "../lib/pharmacyMedicine";
import { ExpiryStatusBadge } from "../components/pharmacy/ExpiryStatusBadge";

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

  const preferences = usePosStore((s) => s.preferences);
  const hospitalityReports = useMemo(() => {
    if (!isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) return null;
    const today = dateKeyKampala(new Date());
    const fromKey =
      range === "month"
        ? today.slice(0, 7) + "-01"
        : range === "week"
          ? dateKeyKampala(new Date(Date.now() - 6 * 86400000))
          : today;
    return computeHospitalityReports(sales, products, { fromKey, toKey: today });
  }, [preferences.businessType, preferences.hospitalityModeEnabled, range, sales, products]);

  const pharmacyExpiryReport = useMemo(() => {
    if (!isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled)) return null;
    return computePharmacyExpiryReport(products);
  }, [preferences.businessType, preferences.pharmacyModeEnabled, products]);

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

      {pharmacyExpiryReport ? (
        <section className="space-y-4 rounded-3xl border border-emerald-200 bg-emerald-50/40 p-4">
          <h2 className="text-lg font-black text-emerald-950">{t(lang, "pharmacyReportsTitle")}</h2>
          <div>
            <p className="text-xs font-black uppercase text-stone-500">{t(lang, "pharmacyReportsExpiring")}</p>
            <p className="mt-1 text-sm font-semibold text-stone-700">
              {t(lang, "pharmacyReportsExpiringValue")}: UGX {pharmacyExpiryReport.expiringValueUgx.toLocaleString()}
            </p>
            {pharmacyExpiryReport.expiring.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm">
                {pharmacyExpiryReport.expiring.slice(0, 20).map((row) => (
                  <li key={row.productId} className="flex justify-between gap-2 font-medium">
                    <span className="min-w-0 truncate">
                      {products.find((p) => p.id === row.productId)
                        ? formatMedicineFullLabel(products.find((p) => p.id === row.productId)!)
                        : row.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-stone-600">
                      {products.find((p) => p.id === row.productId) ? (
                        <ExpiryStatusBadge lang={lang} product={products.find((p) => p.id === row.productId)!} compact />
                      ) : null}
                      {row.expiryDate}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm font-medium text-stone-500">{t(lang, "pharmacyReportsNoExpiring")}</p>
            )}
          </div>
          <div>
            <p className="text-xs font-black uppercase text-red-700">{t(lang, "pharmacyReportsExpired")}</p>
            <p className="mt-1 text-sm font-semibold text-stone-700">
              {t(lang, "pharmacyReportsExpiredValue")}: UGX {pharmacyExpiryReport.expiredValueUgx.toLocaleString()}
            </p>
            {pharmacyExpiryReport.expired.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm">
                {pharmacyExpiryReport.expired.slice(0, 20).map((row) => (
                  <li key={row.productId} className="flex justify-between gap-2 font-medium text-red-900">
                    <span className="min-w-0 truncate">
                      {products.find((p) => p.id === row.productId)
                        ? formatMedicineFullLabel(products.find((p) => p.id === row.productId)!)
                        : row.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {products.find((p) => p.id === row.productId) ? (
                        <ExpiryStatusBadge lang={lang} product={products.find((p) => p.id === row.productId)!} compact />
                      ) : null}
                      {row.expiryDate}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm font-medium text-stone-500">{t(lang, "pharmacyReportsNoExpired")}</p>
            )}
          </div>
        </section>
      ) : null}

      {hospitalityReports ? (
        <section className="space-y-4 rounded-3xl border border-waka-200 bg-waka-50/40 p-4">
          <h2 className="text-lg font-black text-waka-950">{t(lang, "hospitalityReportsTitle")}</h2>
          <p className="text-sm font-semibold text-stone-700">
            {hospitalityReports.completedBillCount} bills · UGX {hospitalityReports.totalRevenueUgx.toLocaleString()} ·{" "}
            {t(lang, "hospitalityReportsAvgBill")} UGX {hospitalityReports.avgBillUgx.toLocaleString()}
          </p>
          {hospitalityReports.waiters.length > 0 ? (
            <div>
              <p className="text-xs font-black uppercase text-stone-500">{t(lang, "hospitalityReportsWaiters")}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {hospitalityReports.waiters.slice(0, 5).map((w) => (
                  <li key={w.waiterId} className="flex justify-between font-medium">
                    <span>{w.label}</span>
                    <span>
                      {w.billCount} · UGX {w.revenueUgx.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {hospitalityReports.categoryMix.length > 0 ? (
            <div>
              <p className="text-xs font-black uppercase text-stone-500">{t(lang, "hospitalityReportsMix")}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {hospitalityReports.categoryMix.map((row) => (
                  <li key={row.kind} className="flex justify-between font-medium capitalize">
                    <span>{row.kind}</span>
                    <span>UGX {row.revenueUgx.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {hospitalityReports.peakHours.length > 0 ? (
            <div>
              <p className="text-xs font-black uppercase text-stone-500">{t(lang, "hospitalityReportsPeak")}</p>
              <ul className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                {hospitalityReports.peakHours
                  .slice()
                  .sort((a, b) => b.revenueUgx - a.revenueUgx)
                  .slice(0, 6)
                  .map((h) => (
                    <li key={h.hour} className="rounded-full bg-white px-3 py-1 ring-1 ring-stone-200">
                      {h.label}: {h.billCount}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
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
