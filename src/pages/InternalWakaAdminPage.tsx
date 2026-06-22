import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { Language } from "../types";
import { fetchWakaInternalAdminMe, type WakaInternalAdminRow } from "../lib/wakaInternalAdmin";
import {
  INTERNAL_ADMIN_PREVIEW_ROW,
  isInternalAdminPreviewActive,
} from "../lib/internalAdminPreview";
import { AdminShell, type AdminSectionId } from "../components/internal-admin/v2/AdminShell";
import { AdminOverviewPage } from "../components/internal-admin/v2/pages/AdminOverviewPage";
import { AdminShopsPage } from "../components/internal-admin/v2/pages/AdminShopsPage";
import { AdminSupportPage } from "../components/internal-admin/v2/pages/AdminSupportPage";
import { AdminBillingPage } from "../components/internal-admin/v2/pages/AdminBillingPage";
import { AdminDevicesPage } from "../components/internal-admin/v2/pages/AdminDevicesPage";
import { AdminAnalyticsPage } from "../components/internal-admin/v2/pages/AdminAnalyticsPage";
import { InternalAdminsManagement } from "../components/internal-admin/InternalAdminsManagement";
import { InternalActivationOpsPage } from "./InternalActivationOpsPage";
import { InternalMarketingAgents } from "../components/internal-admin/InternalMarketingAgents";
import { AdminPilotPage } from "../components/internal-admin/v2/pages/AdminPilotPage";
import { AdminBusinessTypesPage } from "../components/internal-admin/v2/pages/AdminBusinessTypesPage";
import { AdminGrowthCampaignPage } from "../components/internal-admin/v2/pages/AdminGrowthCampaignPage";
import { AdminPricingCampaignsPage } from "../components/internal-admin/v2/pages/AdminPricingCampaignsPage";
import { AdminAiSettingsPage } from "../components/internal-admin/v2/pages/AdminAiSettingsPage";

type Props = {
  lang: Language;
  email: string | null | undefined;
};

function sectionFromPath(pathname: string): AdminSectionId {
  if (pathname.startsWith("/internal/waka/shop/")) return "shop";
  if (pathname === "/internal/waka/shops") return "shops";
  if (pathname === "/internal/waka/devices") return "devices";
  if (pathname === "/internal/waka/analytics") return "analytics";
  if (pathname === "/internal/waka/support") return "support";
  if (pathname === "/internal/waka/billing") return "billing";
  if (pathname === "/internal/waka/billing/pricing-campaigns") return "pricing_campaigns";
  if (pathname === "/internal/waka/agents") return "agents";
  if (pathname === "/internal/waka/activations") return "activations";
  if (pathname === "/internal/waka/pilot") return "pilot";
  if (pathname === "/internal/waka/admins") return "admins";
  if (pathname === "/internal/waka/business-types") return "business_types";
  if (pathname === "/internal/waka/growth-campaign") return "growth_campaign";
  if (pathname === "/internal/waka/ai-settings") return "ai_settings";
  return "overview";
}

export function InternalWakaAdminPage({ lang, email }: Props) {
  const [loading, setLoading] = useState(true);
  const [adminRow, setAdminRow] = useState<WakaInternalAdminRow | null>(null);
  const location = useLocation();
  const previewRequested = isInternalAdminPreviewActive(location.search);
  const section = sectionFromPath(location.pathname);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const row = await fetchWakaInternalAdminMe();
      if (cancelled) return;
      setAdminRow(row);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // If a real internal admin session exists, always prefer live data even if
  // `?preview=1` is in the URL from an old/shared link.
  const previewMode = previewRequested && !adminRow;
  const shellAdmin = useMemo(
    () => (previewMode ? INTERNAL_ADMIN_PREVIEW_ROW : adminRow),
    [adminRow, previewMode],
  );

  let body: React.ReactNode;
  if (section === "shops") {
    body = <AdminShopsPage lang={lang} adminRow={shellAdmin} previewMode={previewMode} />;
  } else if (section === "devices") {
    body = <AdminDevicesPage adminRow={shellAdmin} previewMode={previewMode} />;
  } else if (section === "analytics") {
    body = <AdminAnalyticsPage adminRow={shellAdmin} previewMode={previewMode} />;
  } else if (section === "support") {
    body = <AdminSupportPage lang={lang} adminRow={shellAdmin} previewMode={previewMode} />;
  } else if (section === "billing") {
    body = <AdminBillingPage lang={lang} adminRow={shellAdmin} previewMode={previewMode} />;
  } else if (section === "pricing_campaigns") {
    body = <AdminPricingCampaignsPage adminRow={shellAdmin} previewMode={previewMode} />;
  } else if (section === "activations") {
    body = <InternalActivationOpsPage lang={lang} lovableUi previewMode={previewMode} />;
  } else if (section === "agents") {
    body = <InternalMarketingAgents lang={lang} lovableUi previewMode={previewMode} />;
  } else if (section === "pilot") {
    body = <AdminPilotPage adminRow={shellAdmin} previewMode={previewMode} />;
  } else if (section === "admins") {
    if (!previewMode && adminRow?.role !== "super_admin") {
      body = (
        <div className="rounded-2xl border border-rose-200 bg-white p-6 text-center text-sm font-bold text-rose-800">
          Super admin only.
        </div>
      );
    } else {
      body = <InternalAdminsManagement lang={lang} lovableUi previewMode={previewMode} />;
    }
  } else if (section === "business_types") {
    body = <AdminBusinessTypesPage adminRow={shellAdmin} previewMode={previewMode} />;
  } else if (section === "growth_campaign") {
    body = <AdminGrowthCampaignPage adminRow={shellAdmin} previewMode={previewMode} />;
  } else if (section === "ai_settings") {
    body = <AdminAiSettingsPage adminRow={shellAdmin} previewMode={previewMode} />;
  } else {
    body = (
      <AdminOverviewPage lang={lang} email={email} adminRow={shellAdmin} previewMode={previewMode} />
    );
  }

  return (
    <AdminShell lang={lang} adminRow={shellAdmin} loading={loading} active={section} previewMode={previewMode}>
      {body}
    </AdminShell>
  );
}
