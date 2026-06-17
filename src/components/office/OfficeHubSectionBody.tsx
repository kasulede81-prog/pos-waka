import { lazy, Suspense } from "react";
import {
  Package,
  Truck,
  Users,
  BarChart3,
  LayoutDashboard,
  ScrollText,
  Cloud,
  Share2,
  TrendingUp,
  CreditCard,
  HelpCircle,
  User,
  Banknote,
  ChefHat,
  Pill,
  Shield,
  ClipboardList,
  LayoutGrid,
  Settings,
  UserCog,
  Receipt,
} from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { usePharmacyTerms } from "../../lib/pharmacyTerms";
import { useHospitalityTerms } from "../../lib/hospitalityTerms";
import { useWholesaleTerms } from "../../lib/wholesaleTerms";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../../offline/cloudSync";
import { useOfficeHubAccess } from "../../hooks/useOfficeHubAccess";
import type { OfficeHubSectionId } from "../../lib/officeHubSections";
import { OfficeNavCard } from "./OfficeNavCard";
import { OfficeCloseDayCard } from "./OfficeCloseDayCard";

const OfficeHubDeferredCards = lazy(() =>
  import("./OfficeHubDeferredCards").then((m) => ({ default: m.OfficeHubDeferredCards })),
);

const listClass = "space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 xl:grid-cols-3";

type Props = {
  lang: Language;
  section: OfficeHubSectionId;
};

export function OfficeHubSectionBody({ lang, section }: Props) {
  const access = useOfficeHubAccess();
  const sync = useSyncStatus();
  const syncAttention = sync.pendingCount > 0 || countSalesWithSyncErrors() > 0;
  const pt = usePharmacyTerms(lang, access.preferences.businessType, access.preferences.pharmacyModeEnabled);
  const ht = useHospitalityTerms(lang, access.preferences.businessType, access.preferences.hospitalityModeEnabled);
  const wt = useWholesaleTerms(lang, access.preferences.businessType);
  const modeTerm = access.hospitalityMode ? ht : access.wholesaleMode ? wt : pt;
  const deemphasizePurchasing = access.pharmacyMode || access.hospitalityMode;
  const highlightCustomers = !access.pharmacyMode && !access.hospitalityMode && !access.wholesaleMode;
  const highlightPharmacyPatients = access.pharmacyMode;
  const highlightStock = true;
  const highlightReports = true;
  const highlightCloseDay = !access.pharmacyMode && !access.hospitalityMode ? true : access.hospitalityMode || access.pharmacyMode;

  if (section === "daily" && access.hasDaily) {
    return (
      <ul className={listClass}>
        {access.hospitalityMode && access.can("hospitality.floor") ? (
          <OfficeNavCard
            to="/settings/floor"
            title={t(lang, "floorSetupTitle")}
            subtitle={t(lang, "floorSetupSub")}
            Icon={LayoutGrid}
            highlight
          />
        ) : null}
        {access.hospitalityMode && access.can("hospitality.kitchen") ? (
          <OfficeNavCard
            to="/kitchen"
            title={t(lang, "navKitchen")}
            subtitle={t(lang, "officeCardKitchenSub")}
            Icon={ChefHat}
            highlight
          />
        ) : null}
        {access.hospitalityMode && access.can("pending_sales.manage") ? (
          <OfficeNavCard
            to="/pending-sales"
            title={ht("pendingSale")}
            subtitle={t(lang, "pendingSalesSub")}
            Icon={ClipboardList}
            highlight
          />
        ) : null}
        {access.can("customers.view") && highlightCustomers ? (
          <>
            <OfficeNavCard
              to="/customers"
              title={t(lang, "customers")}
              subtitle={t(lang, "officeCardCustomersSub")}
              Icon={Users}
              highlight
            />
            <OfficeNavCard
              to="/debts"
              title={t(lang, "debts")}
              subtitle={t(lang, "debtsHelp")}
              Icon={Banknote}
              highlight
            />
          </>
        ) : null}
        {access.can("customers.view") && highlightPharmacyPatients ? (
          <OfficeNavCard
            to="/customers"
            title={pt("customers")}
            subtitle={t(lang, "pharmacyPage_patientsDebts")}
            Icon={Users}
            highlight
          />
        ) : null}
        {access.can("customers.view") && access.wholesaleMode ? (
          <OfficeNavCard
            to="/customers"
            title={wt("customers")}
            subtitle={t(lang, "wholesalePage_receivables")}
            Icon={Users}
            highlight
          />
        ) : null}
        {access.pharmacyMode && access.canShopSettings ? (
          <OfficeNavCard
            to="/settings/pharmacy"
            title={t(lang, "settingsHubPharmacy")}
            subtitle={t(lang, "settingsHubPharmacySub")}
            Icon={Pill}
            highlight
          />
        ) : null}
        {access.can("stock.view") ? (
          <OfficeNavCard
            to="/stock"
            title={modeTerm("officeCardStock")}
            subtitle={modeTerm("officeCardStockSub")}
            Icon={Package}
            highlight={highlightStock}
          />
        ) : null}
        {access.canArrangeShelves ? (
          <OfficeNavCard
            to="/settings/shelves"
            title={t(lang, "officeCardShelfArrange")}
            subtitle={t(lang, "officeCardShelfArrangeSub")}
            Icon={LayoutGrid}
          />
        ) : null}
        {access.can("purchases.record") ? (
          <OfficeNavCard
            to="/restock"
            title={t(lang, "officeCardRestock")}
            subtitle={t(lang, "officeCardRestockSub")}
            Icon={Truck}
            deemphasized={deemphasizePurchasing}
          />
        ) : null}
        {access.can("suppliers.view") ? (
          <OfficeNavCard
            to="/suppliers"
            title={t(lang, "officeCardSuppliers")}
            subtitle={t(lang, "officeCardSuppliersSub")}
            Icon={Users}
            deemphasized={deemphasizePurchasing}
          />
        ) : null}
        {access.can("purchases.view") ? (
          <OfficeNavCard
            to="/office/purchases"
            title={t(lang, "officeCardPurchases")}
            subtitle={t(lang, "officeCardPurchasesSub")}
            Icon={Truck}
            deemphasized={deemphasizePurchasing}
          />
        ) : null}
        {access.canRecordExpense ? (
          <OfficeNavCard
            to="/cash-expenses"
            title={t(lang, "officeCardCashExpenses")}
            subtitle={t(lang, "officeCardCashExpensesSub")}
            Icon={Banknote}
          />
        ) : null}
        {access.can("day.close") ? (
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
        {access.showDeferredHub ? (
          <Suspense fallback={null}>
            <OfficeHubDeferredCards
              lang={lang}
              showSuppliers={access.can("suppliers.view")}
              showRestock={access.can("purchases.record")}
            />
          </Suspense>
        ) : null}
      </ul>
    );
  }

  if (section === "insights" && access.hasInsights) {
    return (
      <ul className={listClass}>
        {access.can("receipts.view") ? (
          <OfficeNavCard
            to="/receipts"
            title={t(lang, "receipts")}
            subtitle={t(lang, "officeCardReceiptsSub")}
            Icon={Receipt}
          />
        ) : null}
        {access.can("reports.view") ? (
          <OfficeNavCard
            to="/reports"
            title={t(lang, "officeCardReports")}
            subtitle={
              access.pharmacyMode
                ? t(lang, "officeCardExpiryReportsSub")
                : access.hospitalityMode
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
        {access.canProfit ? (
          <OfficeNavCard
            to="/office/profit"
            title={t(lang, "officeCardProfit")}
            subtitle={t(lang, "officeCardProfitSub")}
            Icon={TrendingUp}
          />
        ) : null}
        {access.pharmacyMode && access.canProfit ? (
          <OfficeNavCard
            to="/office/pharmacy-margins"
            title={t(lang, "officeCardPharmacyMargin")}
            subtitle={t(lang, "officeCardPharmacyMarginSub")}
            Icon={Pill}
          />
        ) : null}
        {access.can("owner.dashboard") ? (
          <OfficeNavCard
            to="/owner"
            title={t(lang, "officeCardOwner")}
            subtitle={t(lang, "officeCardOwnerSub")}
            Icon={LayoutDashboard}
          />
        ) : null}
        {access.can("owner.activity") ? (
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
      </ul>
    );
  }

  if (section === "shop-control" && access.hasShopControl) {
    return (
      <ul className={listClass}>
        {access.canShopSettings ? (
          <OfficeNavCard
            to="/staff-access"
            title={t(lang, "officeCardStaffAccess")}
            subtitle={t(lang, "officeCardStaffAccessSub")}
            Icon={UserCog}
          />
        ) : null}
        {access.can("settings.view") ? (
          <OfficeNavCard
            to="/settings"
            title={t(lang, "officeCardAppSettings")}
            subtitle={t(lang, "officeCardAppSettingsSub")}
            Icon={Settings}
          />
        ) : null}
      </ul>
    );
  }

  if (section === "data" && access.hasData) {
    return (
      <ul className={listClass}>
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
      </ul>
    );
  }

  if (section === "help") {
    return (
      <ul className={listClass}>
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
        {access.showAgentPortal ? (
          <OfficeNavCard
            to="/agent"
            title={t(lang, "officeCardAgentPortal")}
            subtitle={t(lang, "officeCardAgentPortalSub")}
            Icon={Share2}
          />
        ) : null}
      </ul>
    );
  }

  return (
    <p className="rounded-2xl bg-amber-50 px-4 py-4 text-sm font-bold text-amber-950">{t(lang, "officeHubEmpty")}</p>
  );
}
