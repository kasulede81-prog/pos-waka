import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { Language } from "../types";
import { fetchWakaInternalAdminMe, type WakaInternalAdminRow } from "../lib/wakaInternalAdmin";
import { WakaAdminShell } from "../components/internal-admin/WakaAdminShell";
import { InternalOpsDashboard } from "../components/internal-admin/InternalOpsDashboard";
import { InternalAdminsManagement } from "../components/internal-admin/InternalAdminsManagement";
import { InternalActivationOpsPage } from "./InternalActivationOpsPage";

type Props = {
  lang: Language;
  email: string | null | undefined;
};

export function InternalWakaAdminPage({ lang, email }: Props) {
  const [loading, setLoading] = useState(true);
  const [adminRow, setAdminRow] = useState<WakaInternalAdminRow | null>(null);
  const location = useLocation();
  const activeHash = location.hash;
  const isAdminsRoute = location.pathname === "/internal/waka/admins";
  const isActivationsRoute = location.pathname === "/internal/waka/activations";

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

  const shellActive = isActivationsRoute ? "activations" : isAdminsRoute ? "admins" : "overview";

  let body: React.ReactNode;
  if (isActivationsRoute) {
    body = <InternalActivationOpsPage lang={lang} lovableUi />;
  } else if (isAdminsRoute) {
    if (adminRow?.role !== "super_admin") {
      body = (
        <div className="rounded-xl border border-rose-200 bg-white p-6 text-center text-sm font-bold text-rose-800">
          Super admin only.
        </div>
      );
    } else {
      body = <InternalAdminsManagement lang={lang} lovableUi />;
    }
  } else {
    body = (
      <InternalOpsDashboard
        lang={lang}
        email={email}
        adminRow={adminRow}
        previewMode={false}
        lovableUi
      />
    );
  }

  return (
    <WakaAdminShell
      lang={lang}
      adminRow={adminRow}
      loading={loading}
      active={shellActive}
      activeHash={activeHash}
    >
      {body}
    </WakaAdminShell>
  );
}
