import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { Language } from "../types";
import { fetchWakaInternalAdminMe, type WakaInternalAdminRow } from "../lib/wakaInternalAdmin";
import {
  INTERNAL_ADMIN_PREVIEW_ROW,
  isInternalAdminPreviewActive,
} from "../lib/internalAdminPreview";
import { WakaAdminShell } from "../components/internal-admin/WakaAdminShell";
import { InternalOpsDashboard } from "../components/internal-admin/InternalOpsDashboard";
import { InternalAdminsManagement } from "../components/internal-admin/InternalAdminsManagement";
import { InternalActivationOpsPage } from "./InternalActivationOpsPage";
import { InternalMarketingAgents } from "../components/internal-admin/InternalMarketingAgents";

type Props = {
  lang: Language;
  email: string | null | undefined;
};

export function InternalWakaAdminPage({ lang, email }: Props) {
  const [loading, setLoading] = useState(true);
  const [adminRow, setAdminRow] = useState<WakaInternalAdminRow | null>(null);
  const location = useLocation();
  const isAdminsRoute = location.pathname === "/internal/waka/admins";
  const isAgentsRoute = location.pathname === "/internal/waka/agents";
  const isActivationsRoute = location.pathname === "/internal/waka/activations";
  const previewRequested = isInternalAdminPreviewActive(location.search);

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

  /** Sample data when `?preview=1` (dev / `VITE_INTERNAL_ADMIN_PREVIEW=1`). Works with or without a real internal admin row. */
  const previewMode = previewRequested;
  const shellAdmin = useMemo(
    () => (previewMode ? INTERNAL_ADMIN_PREVIEW_ROW : adminRow),
    [adminRow, previewMode],
  );

  const shellActive = isActivationsRoute ? "activations" : isAdminsRoute ? "admins" : isAgentsRoute ? "agents" : "overview";

  let body: React.ReactNode;
  if (isActivationsRoute) {
    body = <InternalActivationOpsPage lang={lang} lovableUi previewMode={previewMode} />;
  } else if (isAgentsRoute) {
    body = <InternalMarketingAgents lang={lang} lovableUi previewMode={previewMode} />;
  } else if (isAdminsRoute) {
    if (!previewMode && adminRow?.role !== "super_admin") {
      body = (
        <div className="rounded-xl border border-rose-200 bg-white p-6 text-center text-sm font-bold text-rose-800">
          Super admin only.
        </div>
      );
    } else {
      body = <InternalAdminsManagement lang={lang} lovableUi previewMode={previewMode} />;
    }
  } else {
    body = (
      <InternalOpsDashboard
        lang={lang}
        email={email}
        adminRow={shellAdmin}
        previewMode={previewMode}
        lovableUi
      />
    );
  }

  return (
    <WakaAdminShell
      lang={lang}
      adminRow={shellAdmin}
      loading={loading}
      active={shellActive}
      previewMode={previewMode}
    >
      {body}
    </WakaAdminShell>
  );
}
