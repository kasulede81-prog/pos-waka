import { useMemo } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import {
  AlertTriangle,
  BarChart3,
  Package,
  Pill,
  RotateCcw,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Shield,
} from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { BusinessTypeOnboarding } from "../components/BusinessTypeOnboarding";
import { dateKeyKampala } from "../lib/datesUg";
import { formatUgx } from "../lib/formatUgx";
import { isPharmacyMode } from "../lib/pharmacy";
import { computePharmacyDashboardStats, expiryBucketLabelKey } from "../lib/pharmacyStats";
import { computePrescriptionDashboardStats } from "../lib/pharmacyPrescriptionStats";
import { computePharmacyPatientDashboardStats } from "../lib/pharmacyPatientDashboardStats";
import { computeComplianceDashboardStats } from "../lib/pharmacyComplianceStats";
import { formatMedicineFullLabel } from "../lib/pharmacyMedicine";
import { expiryTilePresentation } from "../lib/pharmacyExpiry";
import { ExpiryStatusBadge } from "../components/pharmacy/ExpiryStatusBadge";
import { useShallow } from "zustand/react/shallow";
import { HomeTrustBanner } from "../components/trust/HomeTrustBanner";
import { PharmacyExpiredWriteOffPanel } from "../components/pharmacy/PharmacyExpiredWriteOffPanel";
import { HospitalityOpsStatusStrip } from "../components/hospitality/HospitalityOpsStatusStrip";
import {
  filterReturnsForHomeScope,
  filterSalesForHomeScope,
  resolveVisibleHomeMetrics,
} from "../lib/homeVisibility";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import { buildGroupedActivityTimeline } from "../lib/activityNarrative";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../offline/cloudSync";
import { resolveHospitalityHardware } from "../lib/hospitalityHardware";
import { activeDayCloseForDate } from "../lib/dayCloseIdempotency";
import { PHARMACY_DISPENSE_ROUTE } from "../lib/pharmacyNav";

type WorkspaceCardProps = {
  to?: string;
  title: string;
  subtitle?: string;
  metric?: string;
  metricSub?: string;
  variant?: "primary" | "default" | "warning" | "danger";
  Icon: typeof Pill;
  onClick?: () => void;
};

function WorkspaceCard({ to, title, subtitle, metric, metricSub, variant = "default", Icon }: WorkspaceCardProps) {
  const styles = {
    primary: "border-teal-300 bg-gradient-to-br from-teal-600 to-teal-700 text-white shadow-waka-md",
    default: "border-stone-200 bg-white text-stone-950 shadow-waka-sm",
    warning: "border-amber-300 bg-amber-50 text-amber-950 shadow-waka-sm",
    danger: "border-rose-300 bg-rose-50 text-rose-950 shadow-waka-sm",
  }[variant];

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={clsx(
              "text-lg font-black leading-tight sm:text-xl",
              variant === "primary" ? "text-white" : "",
            )}
          >
            {title}
          </p>
          {subtitle ? (
            <p
              className={clsx(
                "mt-1 text-sm font-semibold",
                variant === "primary" ? "text-teal-100" : "text-stone-500",
              )}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
        <Icon
          className={clsx(
            "h-8 w-8 shrink-0 sm:h-10 sm:w-10",
            variant === "primary" ? "text-teal-100" : variant === "danger" ? "text-rose-600" : "text-teal-600",
          )}
          strokeWidth={2}
          aria-hidden
        />
      </div>
      {metric ? (
        <div className="mt-4">
          <p className={clsx("text-2xl font-black sm:text-3xl", variant === "primary" ? "text-white" : "")}>
            {metric}
          </p>
          {metricSub ? (
            <p
              className={clsx(
                "mt-0.5 text-xs font-bold uppercase tracking-wide",
                variant === "primary" ? "text-teal-100" : "text-stone-500",
              )}
            >
              {metricSub}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );

  const className = clsx(
    "flex min-h-[140px] flex-col justify-between rounded-3xl border p-5 transition-waka touch-manipulation sm:min-h-[160px] sm:p-6",
    styles,
    to && "hover:scale-[1.01] active:scale-[0.99]",
  );

  if (to) {
    return (
      <Link to={to} className={className}>
        {inner}
      </Link>
    );
  }
  return <div className={className}>{inner}</div>;
}

export function PharmacyDashboardPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const sync = useSyncStatus();
  const sales = useDeferredReportingSales(false);
  const { preferences, products, returnRecords, customers, purchases, auditLogs, dayCloses, shifts, pharmacyPrescriptions, pharmacyControlledRegister } = usePosStore(
    useShallow((s) => ({
      preferences: s.preferences,
      products: s.products,
      returnRecords: s.returnRecords,
      customers: s.customers,
      purchases: s.purchases,
      auditLogs: s.auditLogs,
      dayCloses: s.dayCloses,
      shifts: s.preferences.shifts,
      pharmacyPrescriptions: s.pharmacyPrescriptions,
      pharmacyControlledRegister: s.pharmacyControlledRegister,
    })),
  );

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const todayKey = dateKeyKampala(new Date());

  const canSell = hasEffectivePermission(actor.role, "pos.sell", snapshot, authMode);
  const canStock = hasEffectivePermission(actor.role, "stock.view", snapshot, authMode);
  const canReports = hasEffectivePermission(actor.role, "reports.view", snapshot, authMode);
  const canPurchases = hasEffectivePermission(actor.role, "purchases.view", snapshot, authMode);
  const canPatients = hasEffectivePermission(actor.role, "customers.view", snapshot, authMode);
  const canReceipts = hasEffectivePermission(actor.role, "receipts.view", snapshot, authMode);
  const canSettings = hasEffectivePermission(actor.role, "settings.view", snapshot, authMode);
  const homeMetrics = resolveVisibleHomeMetrics(actor.role);
  const { canProfit } = resolveProfitVisibility({ role: actor.role, snapshot, authMode });
  const canWriteOff = hasEffectivePermission(actor.role, "pharmacy.expired_writeoff", snapshot, authMode);
  const showActivityFeed = hasEffectivePermission(actor.role, "owner.activity", snapshot, authMode);

  const scopedSales = useMemo(
    () => filterSalesForHomeScope(sales, homeMetrics.scope, actor.userId),
    [sales, homeMetrics.scope, actor.userId],
  );
  const scopedReturns = useMemo(
    () => filterReturnsForHomeScope(returnRecords, sales, homeMetrics.scope, actor.userId),
    [returnRecords, sales, homeMetrics.scope, actor.userId],
  );

  const stats = useMemo(
    () => computePharmacyDashboardStats(products, scopedSales, scopedReturns, todayKey),
    [products, scopedSales, scopedReturns, todayKey],
  );

  const rxStats = useMemo(
    () => computePrescriptionDashboardStats(pharmacyPrescriptions, scopedSales, new Date(todayKey)),
    [pharmacyPrescriptions, scopedSales, todayKey],
  );

  const patientStats = useMemo(
    () => computePharmacyPatientDashboardStats(customers, pharmacyPrescriptions, scopedSales, new Date(todayKey)),
    [customers, pharmacyPrescriptions, scopedSales, todayKey],
  );

  const complianceStats = useMemo(
    () =>
      computeComplianceDashboardStats({
        register: pharmacyControlledRegister,
        products,
        auditLogs,
        preferences,
      }),
    [pharmacyControlledRegister, products, auditLogs, preferences],
  );

  const todayPatients = useMemo(() => {
    const ids = new Set<string>();
    for (const sale of scopedSales) {
      if (dateKeyKampala(sale.createdAt) !== todayKey) continue;
      if (sale.customerId) ids.add(sale.customerId);
    }
    return ids.size;
  }, [scopedSales, todayKey]);

  const purchaseStats = useMemo(() => {
    const active = purchases.filter((p) => !p.voidedAt);
    const todayCount = active.filter((p) => dateKeyKampala(p.createdAt) === todayKey).length;
    const pendingDeliveries = active.filter((p) => p.pendingSync).length;
    return { todayCount, pendingDeliveries };
  }, [purchases, todayKey]);

  const activeShift = useMemo(
    () => (shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId) ?? null,
    [shifts, actor.userId],
  );
  const dayClosed = Boolean(activeDayCloseForDate(dayCloses, todayKey));
  const uploadIssues = countSalesWithSyncErrors();
  const hw = resolveHospitalityHardware({
    hospitalityHardware: preferences.hospitalityHardware,
    businessType: preferences.businessType,
  });
  const failedPrints = (hw.printQueue ?? []).filter((j) => j.status === "failed").length;

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const activityGroups = useMemo(
    () => buildGroupedActivityTimeline(lang, auditLogs, productById, customerById, { maxGroups: 3 }),
    [lang, auditLogs, productById, customerById],
  );

  if (!pharmacy) return null;

  const expiryTiles = [
    { key: "d90" as const, count: stats.expiryCounts.d90 },
    { key: "d60" as const, count: stats.expiryCounts.d60 },
    { key: "d30" as const, count: stats.expiryCounts.d30 },
    { key: "expired" as const, count: stats.expiryCounts.expired },
  ];

  const tileStyles = (key: (typeof expiryTiles)[number]["key"]) => expiryTilePresentation(key);

  const alerts = [
    stats.lowStockCount > 0
      ? { key: "lowStock", label: tTemplate(lang, "pharmacyAlertLowStock", { count: String(stats.lowStockCount) }), to: "/pharmacy/inventory" }
      : null,
    stats.expiryCounts.d30 + stats.expiryCounts.d60 + stats.expiryCounts.d90 > 0
      ? {
          key: "nearExpiry",
          label: tTemplate(lang, "pharmacyAlertNearExpiry", {
            count: String(stats.expiryCounts.d30 + stats.expiryCounts.d60 + stats.expiryCounts.d90),
          }),
          to: "/pharmacy/inventory",
        }
      : null,
    stats.expiryCounts.expired > 0
      ? {
          key: "expired",
          label: tTemplate(lang, "pharmacyAlertExpired", { count: String(stats.expiryCounts.expired) }),
          to: "/pharmacy/inventory",
        }
      : null,
    uploadIssues > 0
      ? { key: "sync", label: tTemplate(lang, "homeTrustSalesNeedUpload", { count: String(uploadIssues) }), to: "/office/backup" }
      : null,
    failedPrints > 0
      ? { key: "printer", label: tTemplate(lang, "hospitalityOpsPrinterFailed", { count: failedPrints }), to: "/office/hardware" }
      : null,
    !activeShift
      ? { key: "shift", label: t(lang, "pharmacyAlertShiftClosed"), to: PHARMACY_DISPENSE_ROUTE }
      : null,
  ].filter(Boolean) as { key: string; label: string; to: string }[];

  const quickActions = [
    canSell ? { to: PHARMACY_DISPENSE_ROUTE, labelKey: "navDispense", Icon: ShoppingCart } : null,
    canStock ? { to: "/pharmacy/inventory?new=1", labelKey: "pharmacyTerm_addMedicine", Icon: Pill } : null,
    canPurchases ? { to: "/pharmacy/inventory?tab=purchases&new=1", labelKey: "pharmacyQuickReceiveStock", Icon: Truck } : null,
    canWriteOff && stats.expiryCounts.expired > 0
      ? { to: "#write-off", labelKey: "pharmacyWriteOffCta", Icon: AlertTriangle }
      : null,
    canReports ? { to: "/pharmacy/reports", labelKey: "pharmacyNav_reports", Icon: BarChart3 } : null,
  ].filter(Boolean) as { to: string; labelKey: string; Icon: typeof Pill }[];

  return (
    <div className="page-content-pad space-y-4">
      {!preferences.onboardingWizardDone && !preferences.onboardingDone ? <BusinessTypeOnboarding lang={lang} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-stone-950">{t(lang, "pharmacyDashTitle")}</h1>
          <p className="mt-1 text-base font-medium text-stone-500">{t(lang, "pharmacyDashSub")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-stone-600">
          <span className="rounded-full border border-stone-200 bg-white px-3 py-1.5">
            {t(lang, "pharmacyDashBusinessDate")}: {todayKey}
            {dayClosed ? ` · ${t(lang, "pharmacyDashDayClosed")}` : ""}
          </span>
          <span className="rounded-full border border-stone-200 bg-white px-3 py-1.5">
            {activeShift ? t(lang, "shiftOpen") : t(lang, "shiftClosed")}
          </span>
        </div>
      </div>

      <HospitalityOpsStatusStrip lang={lang} />

      {quickActions.length > 0 ? (
        <section className="flex gap-2 overflow-x-auto pb-1">
          {quickActions.map((action) =>
            action.to === "#write-off" ? (
              <a
                key={action.labelKey}
                href="#pharmacy-write-off"
                className="inline-flex min-h-[46px] shrink-0 items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-950 shadow-sm"
              >
                <action.Icon className="h-4 w-4" aria-hidden />
                {t(lang, action.labelKey)}
              </a>
            ) : (
              <Link
                key={action.labelKey}
                to={action.to}
                className="inline-flex min-h-[46px] shrink-0 items-center gap-2 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-black text-teal-950 shadow-sm"
              >
                <action.Icon className="h-4 w-4" aria-hidden />
                {t(lang, action.labelKey)}
              </Link>
            ),
          )}
        </section>
      ) : null}

      {alerts.length > 0 ? (
        <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {alerts.map((alert) => (
            <Link
              key={alert.key}
              to={alert.to}
              className="flex min-h-[52px] items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950 shadow-sm"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />
              {alert.label}
            </Link>
          ))}
        </section>
      ) : null}

      <HomeTrustBanner lang={lang} />

      {canSell ? (
        <section className="space-y-2">
          <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyDashRxSection")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              to={PHARMACY_DISPENSE_ROUTE}
              className="rounded-2xl border border-teal-200 bg-teal-50 p-4 transition-waka hover:border-teal-300"
            >
              <p className="text-xs font-black uppercase text-teal-800">{t(lang, "pharmacyDashRxToday")}</p>
              <p className="mt-1 text-3xl font-black text-teal-950">{rxStats.todayPrescriptions}</p>
            </Link>
            <Link
              to={PHARMACY_DISPENSE_ROUTE}
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 transition-waka hover:border-amber-300"
            >
              <p className="text-xs font-black uppercase text-amber-800">{t(lang, "pharmacyDashRxWaiting")}</p>
              <p className="mt-1 text-3xl font-black text-amber-950">{rxStats.waitingVerification}</p>
            </Link>
            <Link
              to={PHARMACY_DISPENSE_ROUTE}
              className="rounded-2xl border border-waka-200 bg-waka-50 p-4 transition-waka hover:border-waka-300"
            >
              <p className="text-xs font-black uppercase text-waka-800">{t(lang, "pharmacyDashRxReady")}</p>
              <p className="mt-1 text-3xl font-black text-waka-950">{rxStats.readyToDispense}</p>
            </Link>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-black uppercase text-emerald-800">{t(lang, "pharmacyDashRxDispensedToday")}</p>
              <p className="mt-1 text-3xl font-black text-emerald-950">{rxStats.dispensedToday}</p>
            </div>
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <p className="text-xs font-black uppercase text-violet-800">{t(lang, "pharmacyDashRxRefillsDue")}</p>
              <p className="mt-1 text-3xl font-black text-violet-950">{rxStats.refillsDue}</p>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs font-black uppercase text-rose-800">{t(lang, "pharmacyDashRxControlledToday")}</p>
              <p className="mt-1 text-3xl font-black text-rose-950">{rxStats.controlledToday}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <p className="text-xs font-black uppercase text-stone-700">{t(lang, "pharmacyDashRxOtcToday")}</p>
              <p className="mt-1 text-3xl font-black text-stone-950">{rxStats.otcSalesToday}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-black uppercase text-stone-700">{t(lang, "pharmacyDashRxAvgDispense")}</p>
              <p className="mt-1 text-2xl font-black text-stone-950">
                {rxStats.avgDispenseMinutes != null
                  ? tTemplate(lang, "pharmacyDashRxAvgDispenseMin", { minutes: String(rxStats.avgDispenseMinutes) })
                  : "—"}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {canPatients ? (
        <section className="space-y-2">
          <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyDashPatientSection")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link to="/pharmacy/patients" className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-black uppercase text-stone-600">{t(lang, "pharmacyDashPatientsToday")}</p>
              <p className="mt-1 text-3xl font-black">{patientStats.patientsToday}</p>
            </Link>
            <Link to="/pharmacy/patients" className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
              <p className="text-xs font-black uppercase text-teal-800">{t(lang, "pharmacyDashNewPatients")}</p>
              <p className="mt-1 text-3xl font-black text-teal-950">{patientStats.newPatientsToday}</p>
            </Link>
            <Link to="/pharmacy/patients" className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <p className="text-xs font-black uppercase text-violet-800">{t(lang, "pharmacyDashRxRefillsDue")}</p>
              <p className="mt-1 text-3xl font-black text-violet-950">{patientStats.refillsDue}</p>
            </Link>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs font-black uppercase text-rose-800">{t(lang, "pharmacyDashMissedRefills")}</p>
              <p className="mt-1 text-3xl font-black text-rose-950">{patientStats.missedRefills}</p>
            </div>
            <Link to="/pharmacy/prescriptions" className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-black uppercase text-amber-800">{t(lang, "pharmacyDashPatientsWaiting")}</p>
              <p className="mt-1 text-3xl font-black text-amber-950">{patientStats.patientsWaiting}</p>
            </Link>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <p className="text-xs font-black uppercase text-stone-700">{t(lang, "pharmacyDashControlledPatients")}</p>
              <p className="mt-1 text-3xl font-black">{patientStats.controlledPatientsToday}</p>
            </div>
            <Link to="/pharmacy/reports/patients" className="rounded-2xl border border-waka-200 bg-waka-50 p-4 lg:col-span-2">
              <p className="text-xs font-black uppercase text-waka-800">{t(lang, "pharmacyDashTopChronic")}</p>
              <ul className="mt-2 space-y-1 text-sm font-bold text-waka-950">
                {patientStats.topChronicPatients.length === 0 ? (
                  <li>—</li>
                ) : (
                  patientStats.topChronicPatients.map((p) => (
                    <li key={p.patientId}>
                      {p.name} · {p.chronicCount}
                    </li>
                  ))
                )}
              </ul>
            </Link>
          </div>
        </section>
      ) : null}

      {canReports ? (
        <section className="space-y-2">
          <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyDashComplianceSection")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Link to="/pharmacy/compliance/register" className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <p className="text-xs font-black uppercase text-violet-800">{t(lang, "pharmacyDashComplianceToday")}</p>
              <p className="mt-1 text-3xl font-black text-violet-950">{complianceStats.controlledToday}</p>
            </Link>
            <Link to="/pharmacy/inventory" className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-black uppercase text-stone-600">{t(lang, "pharmacyDashComplianceStock")}</p>
              <p className="mt-1 text-3xl font-black">{complianceStats.controlledStock}</p>
            </Link>
            <Link to="/pharmacy/compliance/register" className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-black uppercase text-amber-800">{t(lang, "pharmacyDashComplianceOverrides")}</p>
              <p className="mt-1 text-3xl font-black text-amber-950">{complianceStats.recentOverrides}</p>
            </Link>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs font-black uppercase text-rose-800">{t(lang, "pharmacyDashComplianceAlerts")}</p>
              <p className="mt-1 text-3xl font-black text-rose-950">{complianceStats.regulatoryAlerts}</p>
            </div>
            <Link
              to="/pharmacy/compliance/reports"
              className="rounded-2xl border border-teal-200 bg-teal-50 p-4 lg:col-span-1"
            >
              <p className="text-xs font-black uppercase text-teal-800">{t(lang, "pharmacyComplianceReportsLink")}</p>
              <p className="mt-2 flex items-center gap-2 text-sm font-black text-teal-900">
                <Shield className="h-5 w-5" aria-hidden />
                {t(lang, "pharmacyDashComplianceOpen")}
              </p>
            </Link>
          </div>
          {complianceStats.alerts.length > 0 ? (
            <ul className="space-y-2 rounded-2xl border border-rose-200 bg-rose-50/60 p-3">
              {complianceStats.alerts.map((alert) => (
                <li key={alert.id} className="text-sm font-bold text-rose-950">
                  {alert.message}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {canSell ? (
          <WorkspaceCard
            to={PHARMACY_DISPENSE_ROUTE}
            title={t(lang, "pharmacyWorkspaceDispense")}
            subtitle={t(lang, "pharmacyWorkspaceDispenseSub")}
            variant="primary"
            Icon={Pill}
          />
        ) : null}
        {canPatients ? (
          <WorkspaceCard
            to="/pharmacy/patients"
            title={t(lang, "pharmacyTerm_patients")}
            subtitle={t(lang, "pharmacyWorkspacePatientsSub")}
            metric={String(customers.length)}
            metricSub={`${todayPatients} ${t(lang, "pharmacyDashTodayPatients").toLowerCase()}`}
            Icon={Users}
          />
        ) : null}
        {canStock ? (
          <WorkspaceCard
            to="/pharmacy/inventory"
            title={t(lang, "pharmacyWorkspaceInventory")}
            subtitle={t(lang, "pharmacyWorkspaceInventorySub")}
            metric={String(products.length)}
            metricSub={`${stats.lowStockCount} ${t(lang, "pharmacyDashLowStock").toLowerCase()}`}
            Icon={Package}
          />
        ) : null}
        {canPurchases ? (
          <WorkspaceCard
            to="/pharmacy/purchases"
            title={t(lang, "pharmacyNav_purchases")}
            subtitle={t(lang, "pharmacyWorkspacePurchasesSub")}
            metric={String(purchaseStats.todayCount)}
            metricSub={
              purchaseStats.pendingDeliveries > 0
                ? tTemplate(lang, "pharmacyDashPendingDeliveries", { count: String(purchaseStats.pendingDeliveries) })
                : t(lang, "pharmacyDashNoPendingDeliveries")
            }
            Icon={Truck}
          />
        ) : null}
        <WorkspaceCard
          to="/pharmacy/expiry"
          title={t(lang, "pharmacyExpiryCenterTitle")}
          metric={`${stats.expiryCounts.d30} / ${stats.expiryCounts.d60} / ${stats.expiryCounts.d90}`}
          metricSub={`30 · 60 · 90 ${t(lang, "pharmacyDashDays")}`}
          variant={stats.expiryCounts.d30 > 0 ? "warning" : "default"}
          Icon={AlertTriangle}
        />
        <WorkspaceCard
          to="/pharmacy/inventory"
          title={t(lang, "pharmacyWorkspaceExpired")}
          subtitle={t(lang, "pharmacyWorkspaceExpiredSub")}
          metric={String(stats.expiryCounts.expired)}
          metricSub={formatUgx(stats.expiredStockValueUgx)}
          variant={stats.expiryCounts.expired > 0 ? "danger" : "default"}
          Icon={AlertTriangle}
        />
        {canReports ? (
          <WorkspaceCard
            to="/pharmacy/reports"
            title={t(lang, "pharmacyNav_reports")}
            subtitle={t(lang, "pharmacyWorkspaceReportsSub")}
            Icon={BarChart3}
          />
        ) : null}
        {homeMetrics.showShopWideRevenue || homeMetrics.showPersonalRevenue ? (
          <WorkspaceCard
            to="/pharmacy/reports"
            title={t(lang, "pharmacyDashTodaySales")}
            metric={formatUgx(stats.todayDispensingTotalUgx)}
            metricSub={`${stats.todayDispensingCount} ${t(lang, "pharmacyDashTodayDispensings").toLowerCase()}`}
            Icon={ShoppingCart}
          />
        ) : null}
        {canReceipts ? (
          <WorkspaceCard
            to="/pharmacy/returns"
            title={t(lang, "pharmacyNav_returns")}
            subtitle={t(lang, "pharmacyWorkspaceReturnsSub")}
            Icon={RotateCcw}
          />
        ) : null}
        {canSettings ? (
          <WorkspaceCard
            to="/pharmacy/settings"
            title={t(lang, "pharmacyNav_settings")}
            subtitle={t(lang, "pharmacySettingsSub")}
            Icon={Settings}
          />
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {canProfit ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-black uppercase text-emerald-800">{t(lang, "pharmacyDashTodayProfit")}</p>
            <p className={`mt-1 text-2xl font-black ${stats.todayProfitUgx < 0 ? "text-stone-700" : "text-emerald-950"}`}>
              UGX {stats.todayProfitUgx.toLocaleString()}
            </p>
            <p className="text-xs font-semibold text-emerald-800">{t(lang, "estimatedProfitHint")}</p>
          </div>
        ) : null}
        {homeMetrics.showShopWideRevenue || homeMetrics.showPersonalRevenue ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-black uppercase text-amber-800">{t(lang, "pharmacyDashTodayRevenue")}</p>
            <p className="mt-1 text-2xl font-black text-amber-950">
              UGX {stats.todayDispensingTotalUgx.toLocaleString()}
            </p>
            <p className="text-xs font-semibold text-amber-800">
              {stats.todayDispensingCount} {t(lang, "pharmacyDashTodayDispensings").toLowerCase()}
            </p>
          </div>
        ) : null}
        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
          <p className="text-xs font-black uppercase text-stone-700">{t(lang, "pharmacyDashInventoryValue")}</p>
          <p className="mt-1 text-2xl font-black text-stone-950">UGX {stats.inventoryValueUgx.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-waka-200 bg-waka-50 p-4">
          <p className="text-xs font-black uppercase text-waka-800">{t(lang, "pharmacyDashExpiringStockValue")}</p>
          <p className="mt-1 text-2xl font-black text-waka-950">
            UGX {stats.expiringStockValueUgx.toLocaleString()}
          </p>
          <p className="text-xs font-semibold text-waka-800">{t(lang, "pharmacyDashInventoryAtRisk")}</p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs font-black uppercase text-rose-800">{t(lang, "pharmacyDashLowStock")}</p>
          <p className="mt-1 text-3xl font-black text-rose-950">{stats.lowStockCount}</p>
        </div>
        {expiryTiles.map((tile) => {
          const styles = tileStyles(tile.key);
          return (
            <div key={tile.key} className={`rounded-2xl border p-4 ${styles.borderClass} ${styles.bgClass}`}>
              <p className={`text-xs font-black uppercase ${styles.labelClass}`}>
                {t(lang, expiryBucketLabelKey(tile.key))}
              </p>
              <p className={`mt-1 text-3xl font-black ${styles.valueClass}`}>{tile.count}</p>
            </div>
          );
        })}
      </section>

      <div id="pharmacy-write-off">
        <PharmacyExpiredWriteOffPanel lang={lang} products={products} canWriteOff={canWriteOff} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyDashExpiring")}</h2>
          {stats.expiringSoon.length === 0 ? (
            <p className="mt-3 text-sm font-medium text-stone-500">{t(lang, "pharmacyDashNoExpiring")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {stats.expiringSoon.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-bold text-stone-900">{formatMedicineFullLabel(p)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <ExpiryStatusBadge lang={lang} product={p} compact />
                    <span className="font-black text-waka-700">{p.expiryDate}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-3xl border border-red-200 bg-red-50/50 p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-red-950">{t(lang, "pharmacyDashExpired")}</h2>
          {stats.expiredMedicines.length === 0 ? (
            <p className="mt-3 text-sm font-medium text-red-800/80">{t(lang, "pharmacyDashNoExpired")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {stats.expiredMedicines.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-bold text-red-950">{formatMedicineFullLabel(p)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <ExpiryStatusBadge lang={lang} product={p} compact />
                    <span className="font-black text-red-700">{p.expiryDate}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyDashLowStock")}</h2>
          {stats.lowStockMedicines.length === 0 ? (
            <p className="mt-3 text-sm font-medium text-stone-500">{t(lang, "pharmacyDashNoLowStock")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {stats.lowStockMedicines.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-bold text-stone-900">{p.name}</span>
                  <span className="shrink-0 font-bold text-rose-700">
                    {p.stockOnHand} {p.baseUnit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyDashTopMedicines")}</h2>
          {stats.topMedicines.length === 0 ? (
            <p className="mt-3 text-sm font-medium text-stone-500">{t(lang, "pharmacyDashNoDispensings")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {stats.topMedicines.map((m) => (
                <li key={m.productId || m.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-bold text-stone-900">{m.name}</span>
                  <span className="shrink-0 font-bold text-waka-800">{formatUgx(m.revenueUgx)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {showActivityFeed && activityGroups.length > 0 ? (
          <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm lg:col-span-2">
            <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyDashRecentActivity")}</h2>
            <ul className="mt-3 space-y-3">
              {activityGroups.map((group) => (
                <li key={group.id}>
                  <p className="text-xs font-black uppercase text-stone-400">
                    {group.bucketLabel} · {group.actorLabel}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {group.lines.map((line, idx) => (
                      <li key={`${group.id}-${idx}`} className="text-sm font-semibold text-stone-800">
                        {line}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {!sync.isOnline ? (
        <p className="text-center text-xs font-semibold text-stone-500">{t(lang, "pharmacyDashOfflineNote")}</p>
      ) : null}
    </div>
  );
}
