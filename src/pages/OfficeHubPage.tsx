import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";
import { fetchWakaInternalAdminMe } from "../lib/wakaInternalAdmin";
import { fetchMarketingAgentMe } from "../lib/referralAgents";
import { internalAdminPreviewHref, isInternalAdminPreviewEnabled } from "../lib/internalAdminPreview";
import {
  Package,
  Truck,
  Users,
  BarChart3,
  CalendarCheck,
  Settings,
  LayoutDashboard,
  ScrollText,
  UserCog,
  ShieldCheck,
  Cloud,
  Printer,
  Share2,
} from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { OfficePremiumSection } from "../components/office/OfficePremiumSection";

type Card = {
  to: string;
  titleKey: string;
  titleText?: string;
  subKey?: string;
  subText?: string;
  Icon: typeof Package;
  perm: boolean;
};

export function OfficeHubPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const { email } = useAuth();
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
  }, [email]);

  const cards: Card[] = [
    {
      to: "/stock",
      titleKey: "officeCardStock",
      subKey: "officeCardStockSub",
      Icon: Package,
      perm: hasEffectivePermission(actor.role, "stock.view", snapshot, authMode),
    },
    {
      to: "/restock",
      titleKey: "officeCardRestock",
      subKey: "officeCardRestockSub",
      Icon: Truck,
      perm: hasEffectivePermission(actor.role, "purchases.record", snapshot, authMode),
    },
    {
      to: "/suppliers",
      titleKey: "officeCardSuppliers",
      subKey: "officeCardSuppliersSub",
      Icon: Users,
      perm: hasEffectivePermission(actor.role, "suppliers.view", snapshot, authMode),
    },
    {
      to: "/reports",
      titleKey: "officeCardReports",
      subKey: "officeCardReportsSub",
      Icon: BarChart3,
      perm: hasEffectivePermission(actor.role, "reports.view", snapshot, authMode),
    },
    {
      to: "/close-day",
      titleKey: "officeCardCloseDay",
      subKey: "officeCardCloseDaySub",
      Icon: CalendarCheck,
      perm: hasEffectivePermission(actor.role, "day.close", snapshot, authMode),
    },
    {
      to: "/settings",
      titleKey: "officeCardSettings",
      subKey: "officeCardSettingsSub",
      Icon: Settings,
      perm: hasEffectivePermission(actor.role, "settings.view", snapshot, authMode),
    },
    {
      to: "/office/hardware",
      titleKey: "officeCardHardware",
      subKey: "officeCardHardwareSub",
      Icon: Printer,
      perm: hasEffectivePermission(actor.role, "settings.view", snapshot, authMode),
    },
    {
      to: "/agent",
      titleKey: "officeCardAgentPortal",
      subKey: "officeCardAgentPortalSub",
      Icon: Share2,
      perm: showAgentPortal,
    },
    {
      to: "/settings",
      titleKey: "officeCardBackup",
      subKey: "officeCardBackupSub",
      Icon: Cloud,
      perm: hasEffectivePermission(actor.role, "settings.view", snapshot, authMode),
    },
    {
      to: "/owner",
      titleKey: "officeCardOwner",
      subKey: "officeCardOwnerSub",
      Icon: LayoutDashboard,
      perm: hasEffectivePermission(actor.role, "owner.dashboard", snapshot, authMode),
    },
    {
      to: "/owner/activity",
      titleKey: "officeCardActivity",
      subKey: "officeCardActivitySub",
      Icon: ScrollText,
      perm: hasEffectivePermission(actor.role, "owner.activity", snapshot, authMode),
    },
    {
      to: "/staff-access",
      titleKey: "officeCardStaffAccess",
      subKey: "officeCardStaffAccessSub",
      Icon: UserCog,
      perm: hasEffectivePermission(actor.role, "settings.shop", snapshot, authMode),
    },
    {
      to: "/internal/waka",
      titleKey: "internalAdminFooterLink",
      titleText: "Internal dashboard",
      subText: "Manage shops, support, plans, and admin tools",
      Icon: ShieldCheck,
      perm: showInternalAdmin,
    },
  ];

  const visible = cards.filter((c) => c.perm);

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="text-3xl font-black text-stone-950">{t(lang, "officeHubTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "officeHubSub")}</p>
      </div>

      <OfficePremiumSection lang={lang} />

      {visible.length === 0 ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-4 text-sm font-bold text-amber-950">{t(lang, "officeHubEmpty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((c) => (
            <li key={c.to}>
              <Link
                to={c.to}
                className="flex min-h-[84px] items-center gap-3 rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm transition-waka active:scale-[0.99] motion-reduce:active:scale-100"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-waka-50 text-waka-700">
                  <c.Icon className="h-6 w-6" strokeWidth={2.25} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-black text-stone-950">{t(lang, c.titleKey)}</span>
                  {c.titleText ? (
                    <span className="mt-0.5 block text-xs font-semibold text-stone-500">{c.titleText}</span>
                  ) : null}
                  {c.subKey || c.subText ? (
                    <span className="mt-0.5 block text-xs font-semibold text-stone-500">{c.subText ?? t(lang, c.subKey!)}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 border-t border-stone-100 pt-6">
        <Link to="/support" className="inline-flex min-h-[48px] items-center text-base font-black text-waka-800 underline">
          {t(lang, "supportOfficeFooter")} →
        </Link>
        {showInternalAdmin ? (
          <Link
            to="/internal/waka"
            className="inline-flex min-h-[44px] items-center text-sm font-bold text-stone-500 underline decoration-stone-300"
          >
            {t(lang, "internalAdminFooterLink")}
          </Link>
        ) : null}
        {isInternalAdminPreviewEnabled() ? (
          <Link
            to={internalAdminPreviewHref("/internal/waka")}
            className="inline-flex min-h-[44px] items-center text-sm font-bold text-orange-700 underline decoration-orange-300"
          >
            {t(lang, "internalAdminPreviewOfficeLink")}
          </Link>
        ) : null}
        <Link to="/" className="inline-flex min-h-[48px] items-center rounded-2xl font-bold text-waka-800 underline">
          ← {t(lang, "officeBackHome")}
        </Link>
      </div>
    </div>
  );
}
