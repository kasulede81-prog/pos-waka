import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { isWakaInternalAdminEmail } from "../lib/internalAdminAllowlist";
import { fetchWakaInternalAdminMe, type WakaInternalAdminRow } from "../lib/wakaInternalAdmin";
import { InternalOpsDashboard } from "../components/internal-admin/InternalOpsDashboard";

type Props = {
  lang: Language;
  email: string | null | undefined;
};

export function InternalWakaAdminPage({ lang, email }: Props) {
  const [loading, setLoading] = useState(true);
  const [adminRow, setAdminRow] = useState<WakaInternalAdminRow | null>(null);

  const allowlist = isWakaInternalAdminEmail(email);
  const canEnterUi = allowlist || Boolean(adminRow);

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
    return (
      <div className="space-y-4 pb-10">
        <p className="rounded-3xl border-2 border-amber-200 bg-amber-50 px-5 py-6 text-center text-base font-bold text-amber-950">
          {t(lang, "internalAdminDenied")}
        </p>
        <Link to="/" className="inline-flex min-h-[48px] items-center font-bold text-waka-800 underline">
          ← {t(lang, "internalAdminBack")}
        </Link>
      </div>
    );
  }

  return <InternalOpsDashboard lang={lang} email={email} adminRow={adminRow} previewMode={!adminRow && allowlist} />;
}
