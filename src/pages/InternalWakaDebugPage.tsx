import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { supabase } from "../lib/supabase";
import {
  fetchInternalDashboardStats,
  fetchInternalOpsCharts7d,
  fetchWakaInternalAdminMe,
  type WakaInternalAdminRow,
} from "../lib/wakaInternalAdmin";

type Props = {
  lang: Language;
  adminRow: WakaInternalAdminRow;
};

type Probe = { label: string; ok: boolean; detail: string; ms: number };

export function InternalWakaDebugPage({ lang, adminRow }: Props) {
  const [probes, setProbes] = useState<Probe[]>([]);
  const [metricsJson, setMetricsJson] = useState<string>("");
  const [recentJson, setRecentJson] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (!supabase) return;
    setBusy(true);
    const out: Probe[] = [];

    const time = async (label: string, fn: () => Promise<string>) => {
      const t0 = performance.now();
      try {
        const detail = await fn();
        out.push({ label, ok: true, detail, ms: Math.round(performance.now() - t0) });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        out.push({ label, ok: false, detail: msg, ms: Math.round(performance.now() - t0) });
      }
    };

    await time("shops count (head)", async () => {
      const { count, error } = await supabase.from("shops").select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return `count=${count ?? 0}`;
    });

    await time("subscriptions count (head)", async () => {
      const { count, error } = await supabase.from("subscriptions").select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return `count=${count ?? 0}`;
    });

    await time("internal_ops_dashboard_metrics RPC", async () => {
      const { data, error } = await supabase.rpc("internal_ops_dashboard_metrics");
      if (error) throw new Error(error.message);
      setMetricsJson(JSON.stringify(data ?? null, null, 2));
      return "ok (see panel below)";
    });

    await time("internal_ops_recent_shops RPC", async () => {
      const { data, error } = await supabase.rpc("internal_ops_recent_shops", { p_limit: 5 });
      if (error) throw new Error(error.message);
      setRecentJson(JSON.stringify(data ?? [], null, 2));
      return `rows=${Array.isArray(data) ? data.length : 0}`;
    });

    await time("internal_ops_chart_buckets_7d RPC", async () => {
      const { data, error } = await supabase.rpc("internal_ops_chart_buckets_7d");
      if (error) throw new Error(error.message);
      const s = await fetchInternalOpsCharts7d();
      return s ? `labels=${s.signups.length}` : "parsed empty";
    });

    const stats = await fetchInternalDashboardStats();
    await time("fetchInternalDashboardStats()", async () => {
      if (!stats) throw new Error("returned null");
      return `shops=${stats.totalShops} trials=${stats.trialSubscriptions}`;
    });

    setProbes(out);
    setBusy(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-orange-700">{t(lang, "internalDebugBadge")}</p>
          <h1 className="text-2xl font-black text-stone-900">{t(lang, "internalDebugTitle")}</h1>
          <p className="mt-1 text-sm font-semibold text-stone-600">
            {adminRow.email ?? "—"} · {adminRow.role}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run()}
            className="rounded-2xl bg-stone-900 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
          >
            {busy ? "…" : t(lang, "internalDebugReload")}
          </button>
          <Link to="/internal/waka" className="rounded-2xl border-2 border-stone-300 px-4 py-2 text-sm font-bold text-stone-800">
            {t(lang, "internalAdminBack")}
          </Link>
        </div>
      </div>

      <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
        {t(lang, "internalDebugHint")}
      </p>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-stone-900">{t(lang, "internalDebugProbes")}</h2>
        <ul className="mt-4 space-y-2">
          {probes.map((p) => (
            <li key={p.label} className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-black text-stone-900">{p.label}</span>
                <span className={`font-mono text-xs font-bold ${p.ok ? "text-emerald-700" : "text-rose-700"}`}>
                  {p.ok ? "OK" : "FAIL"} · {p.ms}ms
                </span>
              </div>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs text-stone-700">{p.detail}</pre>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-stone-900">internal_ops_dashboard_metrics</h2>
        <pre className="mt-3 max-h-80 overflow-auto rounded-2xl bg-stone-900 p-4 text-xs text-emerald-100">{metricsJson || "—"}</pre>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-stone-900">internal_ops_recent_shops (limit 5)</h2>
        <pre className="mt-3 max-h-80 overflow-auto rounded-2xl bg-stone-900 p-4 text-xs text-emerald-100">{recentJson || "—"}</pre>
      </section>
    </div>
  );
}

/** Standalone loader so route can fetch admin row before rendering debug UI. */
export function InternalWakaDebugRoute({ lang }: { lang: Language }) {
  const [row, setRow] = useState<WakaInternalAdminRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let c = false;
    void (async () => {
      const r = await fetchWakaInternalAdminMe();
      if (!c) {
        setRow(r);
        setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  if (loading) {
    return <div className="h-40 animate-pulse rounded-3xl bg-stone-200/70" />;
  }
  if (!row) {
    return null;
  }
  return <InternalWakaDebugPage lang={lang} adminRow={row} />;
}
