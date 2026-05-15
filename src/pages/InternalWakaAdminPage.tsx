import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { fetchWakaInternalAdminMe, type WakaInternalAdminRow } from "../lib/wakaInternalAdmin";
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
  const isAdminsRoute = location.pathname === "/internal/waka/admins";
  const isActivationsRoute = location.pathname === "/internal/waka/activations";
  const canEnterUi = Boolean(adminRow);

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

  if (loading) {
    return (
      <div className="space-y-6 pb-12 pt-2">
        <div className="h-40 animate-pulse rounded-3xl bg-gradient-to-r from-stone-200 via-orange-100/50 to-stone-200" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-stone-200/70" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-52 animate-pulse rounded-3xl bg-stone-200/60 lg:col-span-2" />
          <div className="h-52 animate-pulse rounded-3xl bg-stone-200/60" />
        </div>
      </div>
    );
  }

  if (!canEnterUi) {
    return <Navigate to="/" replace />;
  }

  if (isActivationsRoute) {
    return <InternalActivationOpsPage lang={lang} />;
  }

  if (isAdminsRoute) {
    if (adminRow?.role !== "super_admin") {
      return (
        <div className="space-y-4 pb-10">
          <p className="rounded-3xl border-2 border-rose-200 bg-rose-50 px-5 py-6 text-center text-base font-bold text-rose-900">
            {t(lang, "internalAdminsSuperOnly")}
          </p>
          <Link to="/internal/waka" className="inline-flex min-h-[48px] items-center font-bold text-waka-800 underline">
            ← {t(lang, "internalAdminBack")}
          </Link>
        </div>
      );
    }
    return <InternalAdminsManagement lang={lang} />;
  }

  return <InternalOpsDashboard lang={lang} email={email} adminRow={adminRow} previewMode={false} />;
}
