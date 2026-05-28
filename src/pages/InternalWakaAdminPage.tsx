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
  if (pathname === "/internal/waka/agents") return "agents";
  if (pathname === "/internal/waka/activations") return "activations";
  if (pathname === "/internal/waka/admins") return "admins";
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

  const previewMode = previewRequested;
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
  } else if (section === "activations") {
    body = <InternalActivationOpsPage lang={lang} lovableUi previewMode={previewMode} />;
  } else if (section === "agents") {
    body = <InternalMarketingAgents lang={lang} lovableUi previewMode={previewMode} />;
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
