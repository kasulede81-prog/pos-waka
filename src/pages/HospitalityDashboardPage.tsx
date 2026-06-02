import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { hasPermission } from "../lib/permissions";
import { BusinessTypeOnboarding } from "../components/BusinessTypeOnboarding";
import { dateKeyKampala } from "../lib/datesUg";
import { localGetDailySalesSummary } from "../lib/localReporting";
import { formatUgxShort, isHospitalityMode, isKitchenEnabledForHospitality } from "../lib/hospitality";
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

  const canFloor = hasPermission(actor.role, "hospitality.floor");
  const kitchenEnabled = isKitchenEnabledForHospitality(
    preferences.businessType,
    preferences.hospitalityKitchenEnabled,
  );
  const canKitchen = kitchenEnabled && hasPermission(actor.role, "hospitality.kitchen");
  const canSell = hasEffectivePermission(actor.role, "pos.sell", snapshot, authMode);
  const canStock = hasEffectivePermission(actor.role, "stock.view", snapshot, authMode);

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

  const todayRevenue = useMemo(
    () => localGetDailySalesSummary(sales, products, returnRecords, todayKey).totalRevenueUgx,
    [sales, products, returnRecords, todayKey],
  );

  const hasOpenSessions = (floor?.sessions.some((s) => s.status === "open" || s.status === "payment_pending") ?? false);

  if (!hospitality) return null;

  return (
    <div className="space-y-4">
      {!preferences.onboardingWizardDone && !preferences.onboardingDone ? <BusinessTypeOnboarding lang={lang} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-stone-950">{t(lang, "hospitalityDashTitle")}</h1>
          <p className="mt-1 text-base font-medium text-stone-500">{t(lang, "hospitalityDashSub")}</p>
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
              className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base font-black text-stone-800 shadow-sm"
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
            <li className="flex flex-wrap items-center gap-2 font-bold text-stone-900">
              <span className={products.length > 0 ? "text-waka-600" : "text-stone-400"}>{products.length > 0 ? "✓" : "①"}</span>
              {t(lang, "hospitalitySetupStep1")}
              {products.length === 0 && canStock ? (
                <Link to="/stock" className="rounded-full bg-waka-600 px-4 py-2 text-sm font-black text-white">
                  {t(lang, "navMenu")}
                </Link>
              ) : null}
            </li>
            <li className="flex flex-wrap items-center gap-2 font-bold text-stone-900">
              <span className={hasOpenSessions ? "text-waka-600" : "text-stone-400"}>{hasOpenSessions ? "✓" : "②"}</span>
              {t(lang, "hospitalitySetupStep2")}
              {!hasOpenSessions && canFloor ? (
                <Link to="/floor" className="rounded-full bg-stone-900 px-4 py-2 text-sm font-black text-white">
                  {t(lang, "navFloor")}
                </Link>
              ) : null}
            </li>
            {kitchenEnabled ? (
              <li className="flex flex-wrap items-center gap-2 font-bold text-stone-900">
                <span className="text-stone-400">③</span>
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
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
            <p className="mt-1 text-2xl font-black text-amber-950">{formatUgxShort(stats.pendingBillsUgx)}</p>
            <p className="mt-1 text-xs font-semibold text-amber-800">{stats.pendingBillCount} open</p>
          </article>
          <article className="rounded-3xl bg-gradient-to-br from-stone-900 to-stone-700 p-4 text-white shadow-waka-sm">
            <p className="text-xs font-black uppercase tracking-wide text-white/80">{t(lang, "hospitalityDashTodayRevenue")}</p>
            <p className="mt-1 text-2xl font-black">UGX {todayRevenue.toLocaleString()}</p>
            <p className="mt-1 text-xs font-semibold text-white/70">{t(lang, "dashboardTodaySalesHint")}</p>
            {kitchenEnabled && stats.kitchenQueueCount > 0 ? (
              <p className="mt-1 text-xs font-semibold text-white/80">
                {stats.kitchenQueueCount} {t(lang, "hospitalityDashKitchenQueue").toLowerCase()}
              </p>
            ) : null}
          </article>
        </section>
      ) : null}

      <section className="rounded-3xl border-2 border-stone-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-black text-stone-900">{t(lang, "hospitalityDashActiveBills")}</h2>
          {canFloor ? (
            <Link to="/floor" className="text-sm font-bold text-waka-700">
              {t(lang, "seeAll")} →
            </Link>
          ) : null}
        </div>
        {openBills.length === 0 ? (
          <p className="mt-4 text-lg text-stone-500">{t(lang, "hospitalityDashNoOpenBills")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {openBills.slice(0, 8).map(({ session, label, subtitle, total }) => (
              <li key={session.id}>
                <Link
                  to={`/floor/order/${session.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-stone-50 px-4 py-3 active:bg-waka-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-black text-stone-900">{label}</p>
                    <p className="text-xs font-medium text-stone-500">{subtitle}</p>
                  </div>
                  <p className="shrink-0 text-sm font-black text-waka-700">
                    {total > 0 ? formatUgxShort(total) : "—"}
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
