import { useMemo } from "react";
import type { Language } from "../types";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { BusinessTypeOnboarding } from "../components/BusinessTypeOnboarding";
import { dateKeyKampala } from "../lib/datesUg";
import { isPharmacyMode } from "../lib/pharmacy";
import { computePharmacyDashboardStats } from "../lib/pharmacyStats";
import { computePrescriptionDashboardStats } from "../lib/pharmacyPrescriptionStats";
import { computePharmacyPatientDashboardStats } from "../lib/pharmacyPatientDashboardStats";
import { computeComplianceDashboardStats } from "../lib/pharmacyComplianceStats";
import { ensurePharmacyPatientProfile } from "../lib/pharmacyPatientProfile";
import { activePrescriptionQueue } from "../lib/pharmacyPrescriptions";
import { useShallow } from "zustand/react/shallow";
import {
  filterReturnsForHomeScope,
  filterSalesForHomeScope,
  resolveVisibleHomeMetrics,
} from "../lib/homeVisibility";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { resolveHospitalityHardware } from "../lib/hospitalityHardware";
import { activeDayCloseForDate } from "../lib/dayCloseIdempotency";
import { PharmacyOpsDashboard } from "../components/pharmacy/dashboard/PharmacyOpsDashboard";
import { buildPharmacyActivityTimeline } from "../components/pharmacy/dashboard/pharmacyDashboardPresentation";

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
  const canWriteOff = hasEffectivePermission(actor.role, "pharmacy.expired_writeoff", snapshot, authMode);
  const showActivityFeed = hasEffectivePermission(actor.role, "owner.activity", snapshot, authMode);
  const homeMetrics = resolveVisibleHomeMetrics(actor.role);
  const { canProfit } = resolveProfitVisibility({ role: actor.role, snapshot, authMode });
  const showRevenue = homeMetrics.showShopWideRevenue || homeMetrics.showPersonalRevenue;

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
  const hw = resolveHospitalityHardware({
    hospitalityHardware: preferences.hospitalityHardware,
    businessType: preferences.businessType,
  });
  const failedPrints = (hw.printQueue ?? []).filter((j) => j.status === "failed").length;

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const allergyAlertCount = useMemo(() => {
    const queue = activePrescriptionQueue(pharmacyPrescriptions);
    const waitingIds = new Set(
      queue.filter((rx) => rx.patientId).map((rx) => rx.patientId as string),
    );
    let count = 0;
    for (const id of waitingIds) {
      const customer = customerById.get(id);
      if (!customer) continue;
      const profile = ensurePharmacyPatientProfile(customer);
      if ((profile.allergies ?? []).length > 0 || profile.allergiesText?.trim()) count += 1;
    }
    return count;
  }, [pharmacyPrescriptions, customerById]);

  const activityItems = useMemo(
    () =>
      showActivityFeed
        ? buildPharmacyActivityTimeline(lang, auditLogs, productById, customerById, 8)
        : [],
    [showActivityFeed, lang, auditLogs, productById, customerById],
  );

  if (!pharmacy) return null;

  return (
    <>
      {!preferences.onboardingWizardDone && !preferences.onboardingDone ? <BusinessTypeOnboarding lang={lang} /> : null}
      <PharmacyOpsDashboard
        lang={lang}
        actorName={actor.displayName ?? actor.role}
        todayKey={todayKey}
        dayClosed={dayClosed}
        activeShift={activeShift}
        sync={sync}
        failedPrints={failedPrints}
        stats={stats}
        rxStats={rxStats}
        patientStats={patientStats}
        complianceStats={complianceStats}
        purchaseStats={purchaseStats}
        allergyAlertCount={allergyAlertCount}
        activityItems={activityItems}
        products={products}
        canSell={canSell}
        canStock={canStock}
        canReports={canReports}
        canPurchases={canPurchases}
        canPatients={canPatients}
        canReceipts={canReceipts}
        canWriteOff={canWriteOff}
        canProfit={canProfit}
        showRevenue={showRevenue}
        showActivityFeed={showActivityFeed}
      />
    </>
  );
}
