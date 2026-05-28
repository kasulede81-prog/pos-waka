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
  Printer,
  Share2,
  TrendingUp,
  CreditCard,
  HelpCircle,
  User,
} from "lucide-react";
import { canSeeOfficeProfit } from "../lib/homeProfit";
import type { Language, Permission } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { OfficePremiumSection } from "../components/office/OfficePremiumSection";
import { OfficeNavSection } from "../components/office/OfficeNavSection";
import { OfficeNavCard } from "../components/office/OfficeNavCard";
import { OfficeCloseDayCard } from "../components/office/OfficeCloseDayCard";

export function OfficeHubPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
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

  const hasDaily =
    can("stock.view") || can("purchases.record") || can("suppliers.view") || can("day.close");
  const hasInsights =
    can("reports.view") ||
    (canSeeOfficeProfit(actor.role, authMode) && can("back_office.access")) ||
    can("owner.dashboard") ||
    can("owner.activity");
  const hasShopControl = can("settings.view") || can("settings.shop");
  const hasData = can("settings.view");
  const hasHelp = true;

  const empty = !hasDaily && !hasInsights && !hasShopControl && !hasData && !hasHelp;

  return (
    <div className="space-y-6 pb-4">
      <header>
        <h1 className="text-2xl font-black tracking-tight text-stone-950 sm:text-3xl">{t(lang, "officeHubTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "officeHubSub")}</p>
      </header>

      <OfficePremiumSection lang={lang} />

      {empty ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-4 text-sm font-bold text-amber-950">{t(lang, "officeHubEmpty")}</p>
      ) : (
        <div className="space-y-6">
          {hasDaily ? (
            <OfficeNavSection title={t(lang, "officeSectionDaily")}>
              {can("stock.view") ? (
                <OfficeNavCard
                  to="/stock"
                  title={t(lang, "officeCardStock")}
                  subtitle={t(lang, "officeCardStockSub")}
                  Icon={Package}
                />
              ) : null}
              {can("purchases.record") ? (
                <OfficeNavCard
                  to="/restock"
                  title={t(lang, "officeCardRestock")}
                  subtitle={t(lang, "officeCardRestockSub")}
                  Icon={Truck}
                />
              ) : null}
              {can("suppliers.view") ? (
                <OfficeNavCard
                  to="/suppliers"
                  title={t(lang, "officeCardSuppliers")}
                  subtitle={t(lang, "officeCardSuppliersSub")}
                  Icon={Users}
                />
              ) : null}
              {can("day.close") ? <OfficeCloseDayCard lang={lang} /> : null}
            </OfficeNavSection>
          ) : null}

          {hasInsights ? (
            <OfficeNavSection title={t(lang, "officeSectionInsights")}>
              {can("reports.view") ? (
                <OfficeNavCard
                  to="/reports"
                  title={t(lang, "officeCardReports")}
                  subtitle={t(lang, "officeCardReportsSub")}
                  Icon={BarChart3}
                />
              ) : null}
              {canSeeOfficeProfit(actor.role, authMode) && can("back_office.access") ? (
                <OfficeNavCard
                  to="/office/profit"
                  title={t(lang, "officeCardProfit")}
                  subtitle={t(lang, "officeCardProfitSub")}
                  Icon={TrendingUp}
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
                <OfficeNavCard
                  to="/owner/activity"
                  title={t(lang, "officeCardActivity")}
                  subtitle={t(lang, "officeCardActivitySub")}
                  Icon={ScrollText}
                />
              ) : null}
            </OfficeNavSection>
          ) : null}

          {hasShopControl ? (
            <OfficeNavSection title={t(lang, "officeSectionShopControl")}>
              {can("settings.shop") ? (
                <OfficeNavCard
                  to="/staff-access"
                  title={t(lang, "officeCardStaffAccess")}
                  subtitle={t(lang, "officeCardStaffAccessSub")}
                  Icon={UserCog}
                />
              ) : null}
              {can("settings.view") ? (
                <OfficeNavCard
                  to="/office/hardware"
                  title={t(lang, "officeCardHardware")}
                  subtitle={t(lang, "officeCardHardwareSub")}
                  Icon={Printer}
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
                subtitle={t(lang, "officeCardBackupSub")}
                Icon={Cloud}
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
              subtitle={t(lang, "officeCardSupportSub")}
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
