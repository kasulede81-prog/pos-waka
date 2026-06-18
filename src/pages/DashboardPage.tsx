import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Language, Sale } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useDashboardAnalytics } from "../hooks/useShopReporting";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { dateKeyKampala } from "../lib/datesUg";
import { localGetDailySalesSummary, localGetWeeklySalesSummary } from "../lib/localReporting";
import { isLowStock } from "../lib/sellingEngine";
import { BusinessTypeOnboarding } from "../components/BusinessTypeOnboarding";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { buildGroupedActivityTimeline } from "../lib/activityNarrative";
import { isHospitalityMode } from "../lib/hospitality";
import { HomeTrustBanner } from "../components/trust/HomeTrustBanner";
import { isPharmacyMode } from "../lib/pharmacy";
import { isWholesaleMode } from "../lib/wholesale";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import {
  filterReturnsForHomeScope,
  filterSalesForHomeScope,
  resolveVisibleHomeMetrics,
} from "../lib/homeVisibility";
import { HospitalityDashboardPage } from "./HospitalityDashboardPage";
import { PharmacyDashboardPage } from "./PharmacyDashboardPage";

function formatDashboardSaleItems(sale: Sale, maxNames = 4): string {
  const names = sale.lines.map((l) => {
    const qty = l.quantity;
    const shown = Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, "");
    return `${l.name} ×${shown}`;
  });
  if (names.length === 0) return "—";
  const head = names.slice(0, maxNames).join(", ");
  const extra = names.length - maxNames;
  return extra > 0 ? `${head} +${extra}` : head;
}

export function DashboardPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const location = useLocation();
  const [deniedBanner, setDeniedBanner] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  useEffect(() => {
    if ((location.state as { backOfficeDenied?: boolean } | null)?.backOfficeDenied) {
      setDeniedBanner(true);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    if (authMode !== "supabase" || snapshot.kind !== "remote" || !snapshot.row.shop_id) return;
    void import("../lib/shopPresence").then(({ sendShopPresenceHeartbeat }) =>
      sendShopPresenceHeartbeat(snapshot.row.shop_id!),
    );
  }, [authMode, snapshot]);

  const canStock = hasEffectivePermission(actor.role, "stock.view", snapshot, authMode);
  const canBackOffice = hasEffectivePermission(actor.role, "back_office.access", snapshot, authMode);
  const canReports = hasEffectivePermission(actor.role, "reports.view", snapshot, authMode);
  const canDayClose = hasEffectivePermission(actor.role, "day.close", snapshot, authMode);
  const canSell = hasEffectivePermission(actor.role, "pos.sell", snapshot, authMode);
  const canReceipts = hasEffectivePermission(actor.role, "receipts.view", snapshot, authMode);
  const profitVisibility = resolveProfitVisibility({ role: actor.role, snapshot, authMode });
  const canProfit = profitVisibility.canProfit;
  const homeMetrics = resolveVisibleHomeMetrics(actor.role);

  const sales = useDeferredReportingSales(includeArchived);
  const returnRecords = usePosStore((s) => s.returnRecords);
  const scopedSales = useMemo(
    () => filterSalesForHomeScope(sales, homeMetrics.scope, actor.userId),
    [sales, homeMetrics.scope, actor.userId],
  );
  const scopedReturns = useMemo(
    () => filterReturnsForHomeScope(returnRecords, sales, homeMetrics.scope, actor.userId),
    [returnRecords, sales, homeMetrics.scope, actor.userId],
  );
  const analytics = useDashboardAnalytics(includeArchived, homeMetrics.scope, actor.userId);
  const salesCount = usePosStore((s) => s.sales.length);
  const products = usePosStore((s) => s.products);
  const preferences = usePosStore((s) => s.preferences);
  const auditLogs = usePosStore((s) => s.auditLogs);
  const customers = usePosStore((s) => s.customers);
  const showActivityFeed = hasEffectivePermission(actor.role, "owner.activity", snapshot, authMode);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const activityGroups = useMemo(
    () => buildGroupedActivityTimeline(lang, auditLogs, productById, customerById, { maxGroups: 3 }),
    [lang, auditLogs, productById, customerById],
  );

  const todayKey = dateKeyKampala(new Date());

  /** Local totals — must match the sales list (server lags when offline / pending sync). */
  const localToday = useMemo(
    () => localGetDailySalesSummary(scopedSales, products, scopedReturns, todayKey),
    [scopedSales, products, scopedReturns, todayKey],
  );
  const localWeek = useMemo(
    () => localGetWeeklySalesSummary(scopedSales, products, scopedReturns),
    [scopedSales, products, scopedReturns],
  );

  const todaySales = useMemo(
    () => scopedSales.filter((s) => dateKeyKampala(s.createdAt) === todayKey),
    [scopedSales, todayKey],
  );

  const salesTodayTotal = localToday.totalRevenueUgx;
  const cashToday = localToday.cashCollectedUgx;
  const debtToday = localToday.debtIssuedUgx;
  const todayProfitUgx = localToday.estimatedProfitUgx;
  const cashWeekDisplay = localWeek.cashCollectedUgx;
  const lowStockProducts = useMemo(() => products.filter((p) => isLowStock(p)), [products]);

  const fastMovers = analytics.fastMovers.map((p) => ({
    id: p.productId,
    name: p.name,
    qty: p.quantity,
    revenue: p.revenueUgx,
  }));

  const recentSales = useMemo(() => todaySales.slice(0, 8), [todaySales]);

  const quickTiles = useMemo(() => products.slice(0, 10), [products]);

  const gridCols =
    homeMetrics.showInventoryMetrics && canStock && canProfit
      ? "lg:grid-cols-2"
      : homeMetrics.showInventoryMetrics && canStock
        ? "lg:grid-cols-3"
        : "lg:grid-cols-2";

  const hospitalityHome = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  if (hospitalityHome) {
    return <HospitalityDashboardPage lang={lang} />;
  }

  const pharmacyHome = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  if (pharmacyHome) {
    return <PharmacyDashboardPage lang={lang} />;
  }
  const wholesaleHome = isWholesaleMode(preferences.businessType);

  return (
    <div className="space-y-4">
      {!preferences.onboardingWizardDone && !preferences.onboardingDone ? <BusinessTypeOnboarding lang={lang} /> : null}

      {deniedBanner ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
          {t(lang, "dashboardDeniedBackOffice")}
        </div>
      ) : null}

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      {preferences.onboardingDone && (products.length === 0 || salesCount === 0) ? (
        <section className="rounded-3xl border-2 border-waka-200 bg-waka-50/90 p-6 shadow-sm">
          <h2 className="text-xl font-black text-waka-950">{t(lang, "setupChecklistTitle")}</h2>
          <p className="mt-1 text-base text-waka-900">{t(lang, "setupChecklistSub")}</p>
          <ol className="mt-4 space-y-3 text-lg">
            <li className="flex flex-wrap items-center gap-2 font-bold text-stone-900">
              <span className={salesCount > 0 ? "text-waka-600" : "text-stone-400"}>{salesCount > 0 ? "✓" : "①"}</span>
              {t(lang, "setupStep2")}
              {salesCount === 0 && canSell ? (
                <Link to="/pos" className="rounded-full bg-stone-900 px-4 py-2 text-sm font-black text-white">
                  {t(lang, "sellTitle")}
                </Link>
              ) : null}
            </li>
            <li className="flex flex-wrap items-center gap-2 font-bold text-stone-900">
              <span className={products.length > 0 ? "text-waka-600" : "text-stone-400"}>{products.length > 0 ? "✓" : "②"}</span>
              {t(lang, "setupStep1")}
              {products.length === 0 && canBackOffice ? (
                <Link to="/office" className="rounded-full bg-waka-600 px-4 py-2 text-sm font-black text-white">
                  {t(lang, "officeHubNav")}
                </Link>
              ) : null}
              {products.length === 0 && !canBackOffice ? (
                <span className="text-sm font-semibold text-stone-600">{t(lang, "setupAskOwnerProducts")}</span>
              ) : null}
            </li>
            <li className="flex flex-wrap items-center gap-2 font-bold text-stone-900">
              <span className="text-stone-400">③</span>
              {t(lang, "setupStep3")}
              {canReports ? (
                <Link to="/reports" className="rounded-full border-2 border-waka-700 px-4 py-2 text-sm font-black text-waka-900">
                  {t(lang, "reports")}
                </Link>
              ) : null}
            </li>
          </ol>
        </section>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-stone-950">
            {wholesaleHome ? t(lang, "wholesaleDashTitle") : t(lang, "homeCashierHello")}
          </h1>
          <p className="mt-1 text-base font-medium text-stone-500">
            {wholesaleHome ? t(lang, "wholesaleDashSub") : t(lang, "homeCashierSub")}
          </p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {canSell ? (
            <Link
              to="/pos"
              className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl bg-waka-600 px-5 py-3 text-base font-black text-white shadow-waka-sm active:bg-waka-700"
            >
              {wholesaleHome ? t(lang, "wholesaleDashGoInvoice") : t(lang, "sellTitle")}
            </Link>
          ) : null}
          {canReceipts ? (
            <Link
              to="/receipts"
              className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base font-black text-stone-800 shadow-sm"
            >
              {wholesaleHome ? t(lang, "navInvoices") : t(lang, "receipts")}
            </Link>
          ) : null}
          {canDayClose ? (
            <Link
              to="/close-day"
              className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-base font-black text-amber-950 shadow-sm"
            >
              {t(lang, "closeDay")}
            </Link>
          ) : null}
        </div>
      </div>

      <HomeTrustBanner lang={lang} />

      {canSell && quickTiles.length > 0 ? (
        <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-black text-stone-900">{t(lang, "dashboardOpenPosTiles")}</h2>
            <Link to="/pos" className="text-sm font-bold text-waka-700">
              {t(lang, "sellTitle")} →
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {quickTiles.map((p) => (
              <Link
                key={p.id}
                to="/pos"
                state={{ preferProductId: p.id }}
                className="rounded-full border border-waka-100 bg-waka-50/80 px-3 py-1.5 text-xs font-black text-waka-950 active:bg-waka-100"
              >
                {p.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {showActivityFeed && activityGroups.length > 0 ? (
        <details className="rounded-3xl border-2 border-stone-100 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-xl font-black text-stone-900 marker:content-none [&::-webkit-details-marker]:hidden">
            {t(lang, "activityFeedExpandSummary")}
          </summary>
          <div className="mt-3 flex items-center justify-end">
            {hasEffectivePermission(actor.role, "owner.activity", snapshot, authMode) ? (
              <Link to="/owner/activity" className="text-sm font-bold text-waka-700">
                {t(lang, "seeAll")}
              </Link>
            ) : null}
          </div>
          <ul className="mt-3 space-y-3">
            {activityGroups.map((g) => (
              <li key={g.id} className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-800">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-black text-waka-900">{g.actorLabel}</span>
                  <span className="text-xs font-bold text-stone-500">{g.bucketLabel}</span>
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {new Date(g.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
                <ul className="mt-2 space-y-1">
                  {g.lines.map((line, i) => (
                    <li key={i} className="font-semibold">
                      {line}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <section className={`grid grid-cols-2 gap-3 ${gridCols}`}>
        {homeMetrics.showShopWideRevenue || homeMetrics.showPersonalRevenue ? (
          <article className="rounded-3xl bg-gradient-to-br from-stone-900 to-stone-700 p-4 text-white shadow-waka-sm">
            <p className="text-xs font-black uppercase tracking-wide text-white/80">
              {wholesaleHome ? t(lang, "wholesaleDashLargeInvoices") : t(lang, "todaySection")}
            </p>
            <p className="mt-1 text-2xl font-black sm:text-3xl">UGX {salesTodayTotal.toLocaleString()}</p>
            <p className="mt-1 text-xs font-semibold text-white/70">
              {wholesaleHome ? t(lang, "wholesaleDashNoInvoices") : t(lang, "dashboardTodaySalesHint")}
            </p>
            <p className="mt-1 text-xs font-semibold text-white/80">
              {t(lang, "dashboardSalesMeta")
                .replace("{{count}}", String(todaySales.length))
                .replace("{{amount}}", cashToday.toLocaleString())}
            </p>
          </article>
        ) : null}
        {homeMetrics.showInventoryMetrics && canStock ? (
          <article className="rounded-3xl border border-rose-200 bg-rose-50 p-4 shadow-waka-sm">
            <p className="text-xs font-black uppercase tracking-wide text-rose-900">
              {wholesaleHome ? t(lang, "wholesaleDashReorderRequired") : t(lang, "cardLowStock")}
            </p>
            <p className="mt-1 text-3xl font-black text-rose-950">{lowStockProducts.length}</p>
            <p className="mt-1 text-xs font-semibold text-rose-800">{t(lang, "almostFinishedHint")}</p>
          </article>
        ) : null}
        {homeMetrics.showShopWideDebt ? (
          <article className="rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 p-4 text-amber-950 shadow-waka-sm">
            <p className="text-xs font-black uppercase tracking-wide text-amber-950/90">
              {wholesaleHome ? t(lang, "wholesaleDashReceivables") : t(lang, "cardDebtToday")}
            </p>
            <p className="mt-1 text-2xl font-black sm:text-3xl">UGX {debtToday.toLocaleString()}</p>
            <p className="mt-1 text-xs font-semibold text-amber-950/80">{t(lang, "dashboardDebtTodayHint")}</p>
          </article>
        ) : null}
        {canProfit && (homeMetrics.showShopWideRevenue || homeMetrics.showPersonalRevenue) ? (
          <article className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-4 shadow-waka-sm">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-900">
              {t(lang, "cardProfitToday")}
            </p>
            <p
              className={`mt-1 text-2xl font-black sm:text-3xl ${todayProfitUgx < 0 ? "text-stone-700" : "text-emerald-950"}`}
            >
              UGX {todayProfitUgx.toLocaleString()}
            </p>
            <p className="mt-1 text-xs font-semibold text-emerald-900/80">{t(lang, "dashboardProfitShortNote")}</p>
          </article>
        ) : null}
      </section>

      {homeMetrics.showWeekCashSummary ? (
        <p className="text-center text-sm font-medium text-stone-500">
          {t(lang, "weekCashHint")}: <span className="font-bold text-stone-800">UGX {cashWeekDisplay.toLocaleString()}</span>
          <span className="mt-0.5 block text-xs font-medium text-stone-400">{t(lang, "dashboardCashInSalesHint")}</span>
        </p>
      ) : null}

      {homeMetrics.showRecentSalesList ? (
      <section className="rounded-3xl border-2 border-stone-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-black text-stone-900">{t(lang, "dashboardTodaySalesTitle")}</h2>
          {canReceipts ? (
            <Link to="/receipts" className="text-sm font-bold text-waka-700">
              {t(lang, "seeAll")}
            </Link>
          ) : null}
        </div>
        {recentSales.length === 0 ? (
          <p className="mt-4 text-lg text-stone-500">{t(lang, "noSalesYet")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {recentSales.map((s) => (
              <li key={s.id} className="rounded-2xl bg-stone-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                      {new Date(s.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="mt-1 text-xs font-medium leading-snug text-stone-600">{formatDashboardSaleItems(s, 6)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-black text-stone-900">UGX {s.totalUgx.toLocaleString()}</p>
                    {s.debtUgx > 0 ? (
                      <p className="mt-0.5 text-[10px] font-semibold text-amber-800">
                        {t(lang, "creditLabel")} UGX {s.debtUgx.toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      ) : null}

      {homeMetrics.showFastMovers ? (
      <section className="rounded-3xl border-2 border-stone-100 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black text-stone-900">{t(lang, "fastToday")}</h2>
        {fastMovers.length === 0 ? (
          <p className="mt-4 text-lg text-stone-500">{t(lang, "noSalesYet")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {fastMovers.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-lg">
                {canSell ? (
                  <Link to="/pos" state={{ preferProductId: m.id }} className="font-bold text-waka-800 underline-offset-2 hover:underline">
                    {m.name}
                  </Link>
                ) : (
                  <span className="font-bold text-stone-900">{m.name}</span>
                )}
                <span className="font-black text-waka-700">UGX {m.revenue.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      ) : null}

      {homeMetrics.showInventoryMetrics && canStock ? (
        <section className="rounded-3xl border-4 border-rose-200 bg-rose-50/80 p-5">
          <h2 className="text-xl font-black text-rose-950">{t(lang, "lowStockTitleFriendly")}</h2>
          {lowStockProducts.length === 0 ? (
            <p className="mt-4 text-lg font-medium text-rose-900/80">{t(lang, "stockOkFriendly")}</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {lowStockProducts.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-lg font-bold text-rose-950 shadow-sm"
                >
                  <span>{p.name}</span>
                  <span className="text-rose-800">
                    {p.stockOnHand.toLocaleString()} {p.baseUnit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {canReports ? (
        <div className="flex justify-center pb-4">
          <Link to="/reports" className="text-lg font-bold text-stone-600 underline">
            {t(lang, "reports")} →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
