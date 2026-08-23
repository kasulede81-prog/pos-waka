import { useMemo } from "react";
import { actorHasEffectivePermission } from "../lib/actorAuthorization";
import { Link } from "react-router-dom";
import { LayoutGrid, Receipt, UtensilsCrossed, Wallet } from "lucide-react";
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
import { EnterpriseCard } from "../components/enterprise/EnterpriseCard";
import { EnterpriseKpiCard } from "../components/enterprise/EnterpriseKpiCard";
import { enterpriseTypeClass } from "../lib/enterpriseTypography";
import { enterpriseSpace } from "../lib/enterpriseSpacing";
import { themeUi } from "../lib/themeTokens";
import clsx from "clsx";

export function HospitalityDashboardPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const sales = useDeferredReportingSales(false);
  const { preferences, products, salesCount, returnRecords, dayCloses } = usePosStore(
    useShallow((s) => ({
      preferences: s.preferences,
      products: s.products,
      salesCount: s.sales.length,
      returnRecords: s.returnRecords,
      dayCloses: s.dayCloses,
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
    () => filterSalesForHomeScope(sales, homeMetrics.scope, actor),
    [sales, homeMetrics.scope, actor],
  );

  const todayRevenue = useMemo(() => {
    if (!homeMetrics.showShopWideRevenue && !homeMetrics.showPersonalRevenue) return null;
    const scopedReturns = filterReturnsForHomeScope(returnRecords, sales, homeMetrics.scope, actor);
    return localGetDailySalesSummary(scopedSales, products, scopedReturns, todayKey, dayCloses).totalRevenueUgx;
  }, [homeMetrics, scopedSales, products, returnRecords, sales, actor, todayKey, dayCloses]);

  const hasOpenSessions = (floor?.sessions.some((s) => s.status === "open" || s.status === "payment_pending") ?? false);

  if (!hospitality) return null;

  return (
    <div className={enterpriseSpace.pageStack}>
      {!preferences.onboardingWizardDone && !preferences.onboardingDone ? <BusinessTypeOnboarding lang={lang} /> : null}

      <div className={`flex flex-wrap items-end justify-between ${enterpriseSpace.controlGap}`}>
        <div>
          <h1 className={enterpriseTypeClass("pageTitle")}>{t(lang, "hospitalityDashTitle")}</h1>
          <p className={enterpriseTypeClass("body", "mt-1 text-muted-foreground")}>{t(lang, "hospitalityDashSub")}</p>
        </div>
        <div className={`flex overflow-x-auto pb-1 ${enterpriseSpace.controlGap}`}>
          {canFloor ? (
            <Link to="/floor" className={clsx(themeUi.btnPrimary, "shrink-0")}>
              {t(lang, "hospitalityDashGoFloor")}
            </Link>
          ) : null}
          {canSell ? (
            <Link to="/pos" className={clsx(themeUi.btnSecondary, "shrink-0")}>
              {t(lang, "hospitalityDashTakeaway")}
            </Link>
          ) : null}
          {canKitchen ? (
            <Link to="/kitchen" className={clsx(themeUi.btnSecondary, "shrink-0")}>
              {t(lang, "hospitalityDashGoKitchen")}
            </Link>
          ) : null}
        </div>
      </div>

      <HomeTrustBanner lang={lang} />

      {preferences.onboardingDone && (products.length === 0 || !hasOpenSessions) && salesCount === 0 ? (
        <EnterpriseCard
          title={t(lang, "setupChecklistTitle")}
          subtitle={t(lang, "setupChecklistSub")}
          className="border-waka-200 bg-waka-50/90 dark:border-waka-800/40 dark:bg-waka-950/20"
        >
          <ol className="space-y-3 text-base">
            <li className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
              <span className={products.length > 0 ? "text-primary" : "text-muted-foreground"}>{products.length > 0 ? "✓" : "①"}</span>
              {t(lang, "hospitalitySetupStep1")}
              {products.length === 0 && canStock ? (
                <Link to="/stock" className={themeUi.btnPrimary + " min-h-0 rounded-full px-4 py-2 text-sm"}>
                  {t(lang, "navMenu")}
                </Link>
              ) : null}
            </li>
            <li className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
              <span className={hasOpenSessions ? "text-primary" : "text-muted-foreground"}>{hasOpenSessions ? "✓" : "②"}</span>
              {t(lang, "hospitalitySetupStep2")}
              {!hasOpenSessions && canFloor ? (
                <Link to="/floor" className={themeUi.btnInverse + " min-h-0 rounded-full px-4 py-2 text-sm"}>
                  {t(lang, "navFloor")}
                </Link>
              ) : null}
            </li>
            {kitchenEnabled ? (
              <li className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                <span className="text-muted-foreground">③</span>
                {t(lang, "hospitalitySetupStep3")}
                {canKitchen ? (
                  <Link to="/kitchen" className={themeUi.btnSecondary + " min-h-0 rounded-full px-4 py-2 text-sm"}>
                    {t(lang, "navKitchen")}
                  </Link>
                ) : null}
              </li>
            ) : null}
          </ol>
        </EnterpriseCard>
      ) : null}

      {stats ? (
        <section className={`${enterpriseSpace.kpiGrid} grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-4`}>
          <EnterpriseKpiCard
            icon={LayoutGrid}
            label={t(lang, "hospitalityDashOpenTables")}
            value={String(stats.openTables)}
            hint={`${stats.occupiedTables} ${t(lang, "hospitalityDashOccupiedTables").toLowerCase()}`}
            tone="highlight"
          />
          <EnterpriseKpiCard
            icon={UtensilsCrossed}
            label={t(lang, "hospitalityDashOpenTabs")}
            value={String(stats.openTabs)}
          />
          <EnterpriseKpiCard
            icon={Receipt}
            label={t(lang, "hospitalityDashPendingBills")}
            value={formatUgx(stats.pendingBillsUgx)}
            hint={`${stats.pendingBillCount} open`}
            tone={stats.pendingBillCount > 0 ? "warning" : "default"}
          />
          {todayRevenue != null ? (
            <EnterpriseKpiCard
              icon={Wallet}
              label={t(lang, "hospitalityDashTodayRevenue")}
              value={`UGX ${todayRevenue.toLocaleString()}`}
              hint={
                kitchenEnabled && stats.kitchenQueueCount > 0
                  ? `${stats.kitchenQueueCount} ${t(lang, "hospitalityDashKitchenQueue").toLowerCase()}`
                  : t(lang, "dashboardTodaySalesHint")
              }
              tone="highlight"
            />
          ) : null}
        </section>
      ) : null}

      <EnterpriseCard
        title={t(lang, "hospitalityDashActiveBills")}
        actions={
          canFloor ? (
            <Link to="/floor" className={themeUi.link}>
              {t(lang, "seeAll")} →
            </Link>
          ) : null
        }
      >
        {openBills.length === 0 ? (
          <p className={enterpriseTypeClass("body", "text-muted-foreground")}>{t(lang, "hospitalityDashNoOpenBills")}</p>
        ) : (
          <ul className="space-y-2">
            {openBills.slice(0, 8).map(({ session, label, subtitle, total }) => (
              <li key={session.id}>
                <Link
                  to={`/floor/order/${session.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl bg-muted/70 px-4 py-3 transition-waka hover:bg-muted active:bg-waka-50 dark:active:bg-waka-950/40"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-foreground">{label}</p>
                    <p className="text-xs font-medium text-muted-foreground">{subtitle}</p>
                  </div>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-waka-700 dark:text-waka-400">
                    {total > 0 ? formatUgx(total) : "—"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </EnterpriseCard>
    </div>
  );
}
