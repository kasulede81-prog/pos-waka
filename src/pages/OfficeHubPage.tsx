import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchWakaInternalAdminMe } from "../lib/wakaInternalAdmin";
import { fetchMarketingAgentMe } from "../lib/referralAgents";
import { internalAdminPreviewHref, isInternalAdminPreviewEnabled } from "../lib/internalAdminPreview";
import {
  Package,
  Truck,
  Users,
  BarChart3,
  Settings,
  LayoutDashboard,
  ScrollText,
  UserCog,
  Cloud,
  Share2,
  TrendingUp,
  CreditCard,
  HelpCircle,
  User,
  Banknote,
  LayoutGrid,
  ChefHat,
  Pill,
  Shield,
  ClipboardList,
} from "lucide-react";
import { canSeeOfficeProfit } from "../lib/homeProfit";
import type { Language, Permission } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { canUseBackupRestore, hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { canRecordCashExpenses } from "../lib/cashExpenses";
import { OfficePremiumSection } from "../components/office/OfficePremiumSection";
import { OfficeNavSection } from "../components/office/OfficeNavSection";
import { OfficeNavCard } from "../components/office/OfficeNavCard";
import { OfficeCloseDayCard } from "../components/office/OfficeCloseDayCard";
import { OfficeSupplierSummaryCard } from "../components/office/OfficeSupplierSummaryCard";
import { OfficeRestockSuggestionsCard } from "../components/office/OfficeRestockSuggestionsCard";
import { usePosStore } from "../store/usePosStore";
import { usePharmacyTerms } from "../lib/pharmacyTerms";
import { useHospitalityTerms } from "../lib/hospitalityTerms";
import { isHospitalityMode } from "../lib/hospitality";
import { isPharmacyMode } from "../lib/pharmacy";
import { isWholesaleMode } from "../lib/wholesale";
import { useWholesaleTerms } from "../lib/wholesaleTerms";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../offline/cloudSync";
import { tTemplate } from "../lib/i18n";

/** One-line upload status in the office header — details live under Save & upload. */
function OfficeSyncStatusChip({ lang }: { lang: Language }) {
  const sync = useSyncStatus();
  const syncErrors = countSalesWithSyncErrors();
  const pending = sync.pendingCount;
  const ok = pending === 0 && syncErrors === 0;

  const label = ok
    ? t(lang, "officeSyncBadgeOk")
    : pending > 0
      ? tTemplate(lang, "officeSyncBadgePending", { count: String(pending) })
      : tTemplate(lang, "officeSyncBadgeErrors", { count: String(syncErrors) });

  return (
    <Link
      to="/office/backup"
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${
        ok
          ? "border border-emerald-200/80 bg-emerald-50 text-emerald-900"
          : "border border-amber-200 bg-amber-50 text-amber-950"
      }`}
    >
      <Cloud className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function OfficeHubPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const hospitalityMode = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  const wholesaleMode = isWholesaleMode(preferences.businessType);
  const pt = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);
  const ht = useHospitalityTerms(lang, preferences.businessType, preferences.hospitalityModeEnabled);
  const wt = useWholesaleTerms(lang, preferences.businessType);
  const modeTerm = hospitalityMode ? ht : wholesaleMode ? wt : pt;
  const deemphasizePurchasing = pharmacyMode || hospitalityMode;
  const { snapshot, authMode } = useSubscription();
  const sync = useSyncStatus();
  const syncAttention = sync.pendingCount > 0 || countSalesWithSyncErrors() > 0;
  const [showInternalAdmin, setShowInternalAdmin] = useState(false);
  const [showAgentPortal, setShowAgentPortal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!supabase) {
        setShowInternalAdmin(false);
        setShowAgentPortal(false);
        return;
      }
      const [me, agent] = await Promise.all([fetchWakaInternalAdminMe(), fetchMarketingAgentMe()]);
      if (cancelled) return;
      setShowInternalAdmin(Boolean(me));
      setShowAgentPortal(Boolean(agent));
    })();
    return () => {
      cancelled = true;
    };
  }, [actor.userId]);

  const can = (perm: Permission) => hasEffectivePermission(actor.role, perm, snapshot, authMode);
  const canBackup = canUseBackupRestore(snapshot, authMode);
  const canRecordExpense = canRecordCashExpenses(actor.role, preferences);
  const canProfit =
    canSeeOfficeProfit(actor.role, authMode) && can("back_office.access") && can("reports.profit");
  const canShopSettings = can("settings.shop");

  const hasDaily =
    can("customers.view") ||
    can("stock.view") ||
    can("purchases.record") ||
    can("suppliers.view") ||
    can("day.close") ||
    canRecordExpense ||
    (hospitalityMode && (can("hospitality.floor") || can("hospitality.kitchen") || can("pending_sales.manage"))) ||
    (pharmacyMode && canShopSettings);
  const hasInsights =
    can("reports.view") ||
    canProfit ||
    can("owner.dashboard") ||
    can("owner.activity");
  const hasShopControl = can("settings.view") || canShopSettings;
  const hasData = can("settings.view") && canBackup;
  const hasHelp = true;

  const empty = !hasDaily && !hasInsights && !hasShopControl && !hasData && !hasHelp;

  const highlightCustomers = !pharmacyMode && !hospitalityMode && !wholesaleMode;
  const highlightPharmacyPatients = pharmacyMode;
  const highlightStock = true;
  const highlightReports = true;
  const highlightCloseDay = !pharmacyMode && !hospitalityMode ? true : hospitalityMode || pharmacyMode;

  return (
    <div className="space-y-6 pb-4">
      <header>
        <h1 className="text-2xl font-black tracking-tight text-stone-950 sm:text-3xl">{t(lang, "officeHubTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "officeHubSub")}</p>
        <div className="mt-2">
          <OfficeSyncStatusChip lang={lang} />
        </div>
      </header>

      <OfficePremiumSection lang={lang} />

      {empty ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-4 text-sm font-bold text-amber-950">{t(lang, "officeHubEmpty")}</p>
      ) : (
        <div className="space-y-6">
          {hasDaily ? (
            <OfficeNavSection title={t(lang, "officeSectionDaily")}>
              {hospitalityMode && can("hospitality.floor") ? (
                <OfficeNavCard
                  to="/settings/floor"
                  title={t(lang, "floorSetupTitle")}
                  subtitle={t(lang, "floorSetupSub")}
                  Icon={LayoutGrid}
                  highlight
                />
              ) : null}
              {hospitalityMode && can("hospitality.kitchen") ? (
                <OfficeNavCard
                  to="/kitchen"
                  title={t(lang, "navKitchen")}
                  subtitle={t(lang, "officeCardKitchenSub")}
                  Icon={ChefHat}
                  highlight
                />
              ) : null}
              {hospitalityMode && can("pending_sales.manage") ? (
                <OfficeNavCard
                  to="/pending-sales"
                  title={ht("pendingSale")}
                  subtitle={t(lang, "pendingSalesSub")}
                  Icon={ClipboardList}
                  highlight
                />
              ) : null}
              {can("customers.view") && highlightCustomers ? (
                <OfficeNavCard
                  to="/debts"
                  title={t(lang, "debts")}
                  subtitle={t(lang, "debtsHelp")}
                  Icon={Banknote}
                  highlight
                />
              ) : null}
              {can("customers.view") && highlightPharmacyPatients ? (
                <OfficeNavCard
                  to="/customers"
                  title={pt("customers")}
                  subtitle={t(lang, "pharmacyPage_patientsDebts")}
                  Icon={Users}
                  highlight
                />
              ) : null}
              {can("customers.view") && wholesaleMode ? (
                <OfficeNavCard
                  to="/customers"
                  title={wt("customers")}
                  subtitle={t(lang, "wholesalePage_receivables")}
                  Icon={Users}
                  highlight
                />
              ) : null}
              {pharmacyMode && canShopSettings ? (
                <OfficeNavCard
                  to="/settings/pharmacy"
                  title={t(lang, "settingsHubPharmacy")}
                  subtitle={t(lang, "settingsHubPharmacySub")}
                  Icon={Pill}
                  highlight
                />
              ) : null}
              {can("stock.view") ? (
                <OfficeNavCard
                  to="/stock"
                  title={modeTerm("officeCardStock")}
                  subtitle={modeTerm("officeCardStockSub")}
                  Icon={Package}
                  highlight={highlightStock}
                />
              ) : null}
              {can("purchases.record") ? (
                <OfficeNavCard
                  to="/restock"
                  title={t(lang, "officeCardRestock")}
                  subtitle={t(lang, "officeCardRestockSub")}
                  Icon={Truck}
                  deemphasized={deemphasizePurchasing}
                />
              ) : null}
              {can("suppliers.view") ? (
                <OfficeNavCard
                  to="/suppliers"
                  title={t(lang, "officeCardSuppliers")}
                  subtitle={t(lang, "officeCardSuppliersSub")}
                  Icon={Users}
                  deemphasized={deemphasizePurchasing}
                />
              ) : null}
              {can("purchases.view") ? (
                <OfficeNavCard
                  to="/office/purchases"
                  title={t(lang, "officeCardPurchases")}
                  subtitle={t(lang, "officeCardPurchasesSub")}
                  Icon={Truck}
                  deemphasized={deemphasizePurchasing}
                />
              ) : null}
              {canRecordExpense ? (
                <OfficeNavCard
                  to="/cash-expenses"
                  title={t(lang, "officeCardCashExpenses")}
                  subtitle={t(lang, "officeCardCashExpensesSub")}
                  Icon={Banknote}
                />
              ) : null}
              {can("day.close") ? (
                <>
                  <OfficeNavCard
                    to="/office/cash-position"
                    title={t(lang, "officeCardCashPosition")}
                    subtitle={t(lang, "officeCardCashPositionSub")}
                    Icon={Banknote}
                    highlight
                  />
                  <OfficeCloseDayCard lang={lang} highlight={highlightCloseDay} />
                </>
              ) : null}
              {can("suppliers.view") ? <OfficeSupplierSummaryCard lang={lang} /> : null}
              {can("purchases.record") ? <OfficeRestockSuggestionsCard lang={lang} /> : null}
            </OfficeNavSection>
          ) : null}

          {hasInsights ? (
            <OfficeNavSection title={t(lang, "officeSectionInsights")}>
              {can("reports.view") ? (
                <OfficeNavCard
                  to="/reports"
                  title={t(lang, "officeCardReports")}
                  subtitle={
                    pharmacyMode
                      ? t(lang, "officeCardExpiryReportsSub")
                      : hospitalityMode
                        ? t(lang, "officeCardHospitalityReportsSub")
                        : t(lang, "officeCardReportsSub")
                  }
                  Icon={BarChart3}
                  highlight={highlightReports}
                  nestedLink={{
                    to: "/office/monthly-reports",
                    label: t(lang, "officeCardReportsMonthlyNested"),
                  }}
                />
              ) : null}
              {canProfit ? (
                <OfficeNavCard
                  to="/office/profit"
                  title={t(lang, "officeCardProfit")}
                  subtitle={t(lang, "officeCardProfitSub")}
                  Icon={TrendingUp}
                />
              ) : null}
              {pharmacyMode && canProfit ? (
                <OfficeNavCard
                  to="/office/pharmacy-margins"
                  title={t(lang, "officeCardPharmacyMargin")}
                  subtitle={t(lang, "officeCardPharmacyMarginSub")}
                  Icon={Pill}
                />
              ) : null}
              {can("owner.dashboard") ? (
                <OfficeNavCard
                  to="/owner"
                  title={t(lang, "officeCardOwner")}
                  subtitle={t(lang, "officeCardOwnerSub")}
                  Icon={LayoutDashboard}
                />
              ) : null}
              {can("owner.activity") ? (
                <>
                  <OfficeNavCard
                    to="/office/audit-center"
                    title={t(lang, "officeCardAuditCenter")}
                    subtitle={t(lang, "officeCardAuditCenterSub")}
                    Icon={Shield}
                  />
                  <OfficeNavCard
                    to="/owner/activity"
                    title={t(lang, "officeCardActivity")}
                    subtitle={t(lang, "officeCardActivitySub")}
                    Icon={ScrollText}
                  />
                </>
              ) : null}
            </OfficeNavSection>
          ) : null}

          {hasShopControl ? (
            <OfficeNavSection title={t(lang, "officeSectionShopControl")}>
              {canShopSettings ? (
                <OfficeNavCard
                  to="/staff-access"
                  title={t(lang, "officeCardStaffAccess")}
                  subtitle={t(lang, "officeCardStaffAccessSub")}
                  Icon={UserCog}
                />
              ) : null}
              {can("settings.view") ? (
                <OfficeNavCard
                  to="/settings"
                  title={t(lang, "officeCardAppSettings")}
                  subtitle={t(lang, "officeCardAppSettingsSub")}
                  Icon={Settings}
                />
              ) : null}
            </OfficeNavSection>
          ) : null}

          {hasData ? (
            <OfficeNavSection title={t(lang, "officeSectionData")}>
              <OfficeNavCard
                to="/office/backup"
                title={t(lang, "officeCardBackup")}
                subtitle={
                  syncAttention
                    ? tTemplate(lang, "officeCardBackupSubAttention", {
                        count: String(sync.pendingCount),
                      })
                    : t(lang, "officeCardBackupSub")
                }
                Icon={Cloud}
                highlight={syncAttention}
              />
            </OfficeNavSection>
          ) : null}

          <OfficeNavSection title={t(lang, "officeSectionHelp")}>
            <OfficeNavCard
              to="/upgrade"
              title={t(lang, "officeCardPlans")}
              subtitle={t(lang, "officeCardPlansSub")}
              Icon={CreditCard}
            />
            <OfficeNavCard
              to="/support"
              title={t(lang, "officeCardSupport")}
              subtitle={t(lang, "officeCardSupportSubDiagnostics")}
              Icon={HelpCircle}
            />
            <OfficeNavCard
              to="/office/account"
              title={t(lang, "officeCardAccount")}
              subtitle={t(lang, "officeCardAccountSub")}
              Icon={User}
            />
            {showAgentPortal ? (
              <OfficeNavCard
                to="/agent"
                title={t(lang, "officeCardAgentPortal")}
                subtitle={t(lang, "officeCardAgentPortalSub")}
                Icon={Share2}
              />
            ) : null}
          </OfficeNavSection>
        </div>
      )}

      {(showInternalAdmin || isInternalAdminPreviewEnabled()) && (
        <div className="border-t border-stone-100 pt-4">
          {showInternalAdmin ? (
            <Link
              to="/internal/waka"
              className="inline-flex min-h-[40px] items-center text-xs font-bold text-stone-500 underline decoration-stone-300"
            >
              {t(lang, "internalAdminFooterLink")}
            </Link>
          ) : null}
          {isInternalAdminPreviewEnabled() ? (
            <Link
              to={internalAdminPreviewHref("/internal/waka")}
              className="ml-4 inline-flex min-h-[40px] items-center text-xs font-bold text-orange-700 underline"
            >
              {t(lang, "internalAdminPreviewOfficeLink")}
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
