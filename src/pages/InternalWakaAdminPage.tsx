import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { isWakaInternalAdminEmail } from "../lib/internalAdminAllowlist";
import {
  fetchFieldVisitsOpen,
  fetchInternalDashboardStats,
  fetchWakaInternalAdminMe,
  googleMapsDirectionsUrl,
  markFieldVisitCompleted,
  type FieldVisitRow,
  type InternalDashboardStats,
  type WakaInternalAdminRow,
} from "../lib/wakaInternalAdmin";

type Props = {
  lang: Language;
  email: string | null | undefined;
};

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <li className="rounded-2xl border border-stone-200 bg-white p-4 shadow-waka-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-stone-900">{value}</p>
    </li>
  );
}

export function InternalWakaAdminPage({ lang, email }: Props) {
  const [loading, setLoading] = useState(true);
  const [adminRow, setAdminRow] = useState<WakaInternalAdminRow | null>(null);
  const [stats, setStats] = useState<InternalDashboardStats | null>(null);
  const [visits, setVisits] = useState<FieldVisitRow[]>([]);
  const [statsError, setStatsError] = useState(false);
  const [visitBusyId, setVisitBusyId] = useState<string | null>(null);
  const [visitMsg, setVisitMsg] = useState<string | null>(null);

  const allowlist = isWakaInternalAdminEmail(email);
  const canEnterUi = allowlist || Boolean(adminRow);

  const reloadOps = useCallback(async () => {
    if (!adminRow) {
      setStats(null);
      setVisits([]);
      setStatsError(false);
      return;
    }
    setStatsError(false);
    const [s, v] = await Promise.all([fetchInternalDashboardStats(), fetchFieldVisitsOpen()]);
    if (!s) setStatsError(true);
    setStats(s);
    setVisits(v);
  }, [adminRow]);

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

  useEffect(() => {
    if (!adminRow) return;
    void reloadOps();
  }, [adminRow, reloadOps]);

  if (loading) {
    return (
      <div className="pb-10 pt-4">
        <p className="text-center text-base font-semibold text-stone-600">{t(lang, "internalLoading")}</p>
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

  const fmtUgx = (n: number | null | undefined) =>
    n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-UG");

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="text-3xl font-black text-stone-900">{t(lang, "internalAdminTitle")}</h1>
        <p className="mt-2 text-base font-medium text-stone-600">{t(lang, "internalAdminSub")}</p>
        {adminRow ? (
          <p className="mt-2 text-sm font-bold text-waka-800">
            {t(lang, "internalAdminLiveTitle")} · {adminRow.role}
          </p>
        ) : (
          <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">{t(lang, "internalAdminDbGateHint")}</p>
        )}
      </div>

      {adminRow ? (
        <>
          {statsError ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
              {t(lang, "internalStatsError")}
            </p>
          ) : null}
          {stats ? (
            <section>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard label={t(lang, "internalStat_totalShops")} value={stats.totalShops} />
                <StatCard label={t(lang, "internalStat_activeToday")} value={stats.activeToday} />
                <StatCard label={t(lang, "internalStat_trialSubs")} value={stats.trialSubscriptions} />
                <StatCard label={t(lang, "internalStat_paidSubs")} value={stats.paidSubscriptions} />
                <StatCard label={t(lang, "internalStat_expiredSubs")} value={stats.expiredSubscriptions} />
                <StatCard label={t(lang, "internalStat_salesTotal")} value={fmtUgx(stats.salesTotalUgx)} />
              </ul>
              <div className="mt-4 rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
                <p className="text-sm font-black uppercase tracking-wide text-stone-500">{t(lang, "internalStat_topDistricts")}</p>
                {stats.shopsByDistrict.length === 0 ? (
                  <p className="mt-2 text-sm text-stone-600">—</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm font-semibold text-stone-800">
                    {stats.shopsByDistrict.map((d) => (
                      <li key={d.label}>
                        · {d.label}: {d.count}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ) : null}

          <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
            <p className="text-lg font-black text-stone-900">{t(lang, "internalFieldVisitsTitle")}</p>
            {visitMsg ? <p className="mt-2 text-sm font-bold text-rose-700">{visitMsg}</p> : null}
            {visits.length === 0 ? (
              <p className="mt-3 text-sm text-stone-600">{t(lang, "internalVisitNoOpen")}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {visits.map((v) => {
                  const shop = v.shops;
                  const lat = shop?.latitude ?? null;
                  const lng = shop?.longitude ?? null;
                  const canDir = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
                  return (
                    <li key={v.id} className="rounded-2xl border border-stone-100 bg-stone-50/80 p-3">
                      <p className="font-black text-stone-900">{shop?.name ?? v.shop_id}</p>
                      <p className="text-xs font-semibold text-stone-500">
                        {[shop?.district, shop?.city].filter(Boolean).join(" · ") || "—"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {canDir ? (
                          <a
                            href={googleMapsDirectionsUrl(lat!, lng!)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[44px] items-center rounded-xl bg-waka-600 px-3 py-2 text-sm font-black text-white"
                          >
                            {t(lang, "internalVisitDirections")}
                          </a>
                        ) : null}
                        <button
                          type="button"
                          disabled={visitBusyId === v.id}
                          className="inline-flex min-h-[44px] items-center rounded-xl border-2 border-stone-300 bg-white px-3 py-2 text-sm font-black text-stone-900 disabled:opacity-50"
                          onClick={async () => {
                            setVisitMsg(null);
                            setVisitBusyId(v.id);
                            const r = await markFieldVisitCompleted(v.id);
                            setVisitBusyId(null);
                            if (!r.ok) {
                              setVisitMsg(r.message ?? t(lang, "internalVisitDoneError"));
                              return;
                            }
                            void reloadOps();
                          }}
                        >
                          {visitBusyId === v.id ? "…" : t(lang, "internalVisitDone")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2">
        {[
          { title: "internalAdminShopsCard", hint: "internalAdminShopsHint" },
          { title: "internalAdminSubsCard", hint: "internalAdminSubsHint" },
          { title: "internalAdminSupportCard", hint: "internalAdminSupportHint" },
          { title: "internalAdminMapCard", hint: "internalAdminMapHint" },
          { title: "internalAdminInsightsCard", hint: "internalAdminInsightsHint" },
        ].map((c) => (
          <li key={c.title} className="rounded-3xl border border-stone-200 bg-stone-50/50 p-4">
            <p className="text-sm font-black text-stone-900">{t(lang, c.title)}</p>
            <p className="mt-1 text-xs font-medium text-stone-600">{t(lang, c.hint)}</p>
          </li>
        ))}
      </ul>

      <Link to="/" className="inline-flex min-h-[48px] items-center font-bold text-waka-800 underline">
        ← {t(lang, "internalAdminBack")}
      </Link>
    </div>
  );
}
