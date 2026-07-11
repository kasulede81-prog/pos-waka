import { useMemo } from "react";
import { actorHasEffectivePermission } from "../lib/actorAuthorization";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";

import {
  filterReturnsForHomeScope,
  filterSalesForHomeScope,
  resolveVisibleHomeMetrics,
} from "../lib/homeVisibility";
import { BusinessTypeOnboarding } from "../components/BusinessTypeOnboarding";
import { dateKeyKampala } from "../lib/datesUg";
import { localGetDailySalesSummary } from "../lib/localReporting";
import { isHospitalityMode, isKitchenEnabledForHospitality } from "../lib/hospitality";
import { formatUgx } from "../lib/formatUgx";
import {
  activeSessions,
  computeHospitalityDashboardStats,
  sessionBillTotal,
  sessionDisplayLabel,
  sessionSubtitle,
} from "../lib/hospitalityStats";
import { useShallow } from "zustand/react/shallow";
import { HomeTrustBanner } from "../components/trust/HomeTrustBanner";

export function HospitalityDashboardPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const sales = useDeferredReportingSales(false);
  const { preferences, products, salesCount, returnRecords } = usePosStore(
    useShallow((s) => ({
      preferences: s.preferences,
      products: s.products,
      salesCount: s.sales.length,
      returnRecords: s.returnRecords,
    })),
  );

  const floor = preferences.hospitalityFloor;
  const hospitality = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  const todayKey = dateKeyKampala(new Date());

  const homeMetrics = resolveVisibleHomeMetrics(actor.role);
  const canFloor = actorHasEffectivePermission(actor, "hospitality.floor", snapshot, authMode);
  const kitchenEnabled = isKitchenEnabledForHospitality(
    preferences.businessType,
    preferences.hospitalityKitchenEnabled,
  );
  const canKitchen = kitchenEnabled && actorHasEffectivePermission(actor, "hospitality.kitchen", snapshot, authMode);
  const canSell = actorHasEffectivePermission(actor, "pos.sell", snapshot, authMode);
  const canStock = actorHasEffectivePermission(actor, "stock.view", snapshot, authMode);

  const stats = useMemo(
    () => (floor ? computeHospitalityDashboardStats(floor, sales) : null),
    [floor, sales],
  );

  const openBills = useMemo(() => {
    if (!floor) return [];
    return activeSessions(floor)
      .map((session) => ({
        session,
        total: sessionBillTotal(session, sales),
        subtitle: sessionSubtitle(session, sales),
        label: sessionDisplayLabel(session, floor),
      }))
      .sort((a, b) => b.total - a.total);
  }, [floor, sales]);

  const scopedSales = useMemo(
    () => filterSalesForHomeScope(sales, homeMetrics.scope, actor.userId),
    [sales, homeMetrics.scope, actor.userId],
  );

  const todayRevenue = useMemo(() => {
    if (!homeMetrics.showShopWideRevenue && !homeMetrics.showPersonalRevenue) return null;
    const scopedReturns = filterReturnsForHomeScope(returnRecords, sales, homeMetrics.scope, actor.userId);
    return localGetDailySalesSummary(scopedSales, products, scopedReturns, todayKey).totalRevenueUgx;
  }, [homeMetrics, scopedSales, products, returnRecords, sales, actor.userId, todayKey]);

  const hasOpenSessions = (floor?.sessions.some((s) => s.status === "open" || s.status === "payment_pending") ?? false);

  if (!hospitality) return null;

  return (
    <div className="space-y-4">
      {!preferences.onboardingWizardDone && !preferences.onboardingDone ? <BusinessTypeOnboarding lang={lang} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">{t(lang, "hospitalityDashTitle")}</h1>
          <p className="mt-1 text-base font-medium text-muted-foreground">{t(lang, "hospitalityDashSub")}</p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {canFloor ? (
            <Link
              to="/floor"
              className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl bg-waka-600 px-5 py-3 text-base font-black text-white shadow-waka-sm"
            >
              {t(lang, "hospitalityDashGoFloor")}
            </Link>
          ) : null}
          {canSell ? (
            <Link
              to="/pos"
              className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl border border-border bg-card px-4 py-3 text-base font-black text-foreground shadow-sm"
            >
              {t(lang, "hospitalityDashTakeaway")}
            </Link>
          ) : null}
          {canKitchen ? (
            <Link
              to="/kitchen"
              className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-base font-black text-amber-950 shadow-sm"
            >
              {t(lang, "hospitalityDashGoKitchen")}
            </Link>
          ) : null}
        </div>
      </div>

      <HomeTrustBanner lang={lang} />

      {preferences.onboardingDone && (products.length === 0 || !hasOpenSessions) && salesCount === 0 ? (
        <section className="rounded-3xl border-2 border-waka-200 bg-waka-50/90 p-6 shadow-sm">
          <h2 className="text-xl font-black text-waka-950">{t(lang, "setupChecklistTitle")}</h2>
          <p className="mt-1 text-base text-waka-900">{t(lang, "setupChecklistSub")}</p>
          <ol className="mt-4 space-y-3 text-lg">
            <li className="flex flex-wrap items-center gap-2 font-bold text-foreground">
              <span className={products.length > 0 ? "text-waka-600" : "text-muted-foreground"}>{products.length > 0 ? "✓" : "①"}</span>
              {t(lang, "hospitalitySetupStep1")}
              {products.length === 0 && canStock ? (
                <Link to="/stock" className="rounded-full bg-waka-600 px-4 py-2 text-sm font-black text-white">
                  {t(lang, "navMenu")}
                </Link>
              ) : null}
            </li>
            <li className="flex flex-wrap items-center gap-2 font-bold text-foreground">
              <span className={hasOpenSessions ? "text-waka-600" : "text-muted-foreground"}>{hasOpenSessions ? "✓" : "②"}</span>
              {t(lang, "hospitalitySetupStep2")}
              {!hasOpenSessions && canFloor ? (
                <Link to="/floor" className="rounded-full bg-foreground px-4 py-2 text-sm font-black text-background">
                  {t(lang, "navFloor")}
                </Link>
              ) : null}
            </li>
            {kitchenEnabled ? (
              <li className="flex flex-wrap items-center gap-2 font-bold text-foreground">
                <span className="text-muted-foreground">③</span>
                {t(lang, "hospitalitySetupStep3")}
                {canKitchen ? (
                  <Link to="/kitchen" className="rounded-full border-2 border-waka-700 px-4 py-2 text-sm font-black text-waka-900">
                    {t(lang, "navKitchen")}
                  </Link>
                ) : null}
              </li>
            ) : null}
          </ol>
        </section>
      ) : null}

      {stats ? (
        <section className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 shadow-waka-sm">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-900">{t(lang, "hospitalityDashOpenTables")}</p>
            <p className="mt-1 text-3xl font-black text-emerald-950">{stats.openTables}</p>
            <p className="mt-1 text-xs font-semibold text-emerald-800">
              {stats.occupiedTables} {t(lang, "hospitalityDashOccupiedTables").toLowerCase()}
            </p>
          </article>
          <article className="rounded-3xl border border-violet-200 bg-violet-50 p-4 shadow-waka-sm">
            <p className="text-xs font-black uppercase tracking-wide text-violet-900">{t(lang, "hospitalityDashOpenTabs")}</p>
            <p className="mt-1 text-3xl font-black text-violet-950">{stats.openTabs}</p>
          </article>
          <article className="rounded-3xl border border-amber-200 bg-amber-50 p-4 shadow-waka-sm">
            <p className="text-xs font-black uppercase tracking-wide text-amber-900">{t(lang, "hospitalityDashPendingBills")}</p>
            <p className="mt-1 text-2xl font-black text-amber-950">{formatUgx(stats.pendingBillsUgx)}</p>
            <p className="mt-1 text-xs font-semibold text-amber-800">{stats.pendingBillCount} open</p>
          </article>
          {todayRevenue != null ? (
          <article className="rounded-3xl bg-gradient-to-br from-foreground to-foreground/80 p-4 text-white shadow-waka-sm">
            <p className="text-xs font-black uppercase tracking-wide text-white/80">{t(lang, "hospitalityDashTodayRevenue")}</p>
            <p className="mt-1 text-2xl font-black">UGX {todayRevenue.toLocaleString()}</p>
            <p className="mt-1 text-xs font-semibold text-white/70">{t(lang, "dashboardTodaySalesHint")}</p>
            {kitchenEnabled && stats.kitchenQueueCount > 0 ? (
              <p className="mt-1 text-xs font-semibold text-white/80">
                {stats.kitchenQueueCount} {t(lang, "hospitalityDashKitchenQueue").toLowerCase()}
              </p>
            ) : null}
          </article>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-3xl border-2 border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-black text-foreground">{t(lang, "hospitalityDashActiveBills")}</h2>
          {canFloor ? (
            <Link to="/floor" className="text-sm font-bold text-waka-700">
              {t(lang, "seeAll")} →
            </Link>
          ) : null}
        </div>
        {openBills.length === 0 ? (
          <p className="mt-4 text-lg text-muted-foreground">{t(lang, "hospitalityDashNoOpenBills")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {openBills.slice(0, 8).map(({ session, label, subtitle, total }) => (
              <li key={session.id}>
                <Link
                  to={`/floor/order/${session.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3 active:bg-waka-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-black text-foreground">{label}</p>
                    <p className="text-xs font-medium text-muted-foreground">{subtitle}</p>
                  </div>
                  <p className="shrink-0 text-sm font-black text-waka-700">
                    {total > 0 ? formatUgx(total) : "—"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
