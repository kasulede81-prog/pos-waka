import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import { KpiPulseCard } from "../primitives";
import {
  adminSetShopPilotCohort,
  fetchPilotDashboard,
  fetchPilotShops,
  type PilotDashboardMetrics,
  type PilotShopRow,
} from "../../../../lib/internalOpsHardening";
import { internalAdminShopHref } from "../../../../lib/internalAdminPreview";
import { AdminDiagnosticsImportPanel } from "../../ops/AdminDiagnosticsImportPanel";
import { AdminOperationalAlertsPanel } from "../../ops/AdminOperationalAlertsPanel";
import { AdminCrashSummaryPanel } from "../../ops/AdminCrashSummaryPanel";
import { AdminMigrationStatusPanel } from "../../ops/AdminMigrationStatusPanel";
import { DeveloperSystemHealthPanel } from "../../../settings/DeveloperSystemHealthPanel";
import { adminPermissions } from "../adminRoles";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode: boolean;
};

const HEALTH_CLS: Record<string, string> = {
  healthy: "bg-emerald-100 text-emerald-900",
  sync_failure: "bg-rose-100 text-rose-900",
  queue_overload: "bg-amber-100 text-amber-900",
  offline: "bg-muted text-foreground",
  outdated_version: "bg-violet-100 text-violet-900",
  suspended: "bg-border text-foreground",
};

export function AdminPilotPage({ adminRow, previewMode }: Props) {
  const navigate = useNavigate();
  const perms = adminPermissions(adminRow);
  const [metrics, setMetrics] = useState<PilotDashboardMetrics | null>(null);
  const [shops, setShops] = useState<PilotShopRow[]>([]);
  const [loading, setLoading] = useState(!previewMode);
  const [businessType, setBusinessType] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [syncFilter, setSyncFilter] = useState("");

  const load = useCallback(async () => {
    if (previewMode) {
      setMetrics({
        total_pilot_shops: 2,
        active_pilot_shops: 1,
        at_risk_pilot_shops: 1,
        shops_sync_failure: 1,
        shops_queue_overload: 0,
        shops_offline_24h: 0,
        shops_outdated_version: 1,
        pilot_revenue_ugx_30d: 1_200_000,
        pilot_crashes_today: 0,
        target_app_version: "1.0.5",
      });
      setShops([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [dash, list] = await Promise.all([
      fetchPilotDashboard(),
      fetchPilotShops({
        businessType: businessType || undefined,
        planCode: planCode || undefined,
        activeOnly: activeFilter === "all" ? null : activeFilter === "active",
        syncFilter: syncFilter || undefined,
      }),
    ]);
    setMetrics(dash);
    setShops(list);
    setLoading(false);
  }, [previewMode, businessType, planCode, activeFilter, syncFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const businessTypes = useMemo(() => {
    const s = new Set<string>();
    for (const row of shops) {
      if (row.business_type) s.add(row.business_type);
    }
    return [...s].sort();
  }, [shops]);

  const plans = useMemo(() => {
    const s = new Set<string>();
    for (const row of shops) {
      if (row.plan_code) s.add(row.plan_code);
    }
    return [...s].sort();
  }, [shops]);

  return (
    <div className="space-y-5 pb-16">
      <div>
        <h1 className="text-2xl font-black text-foreground">Pilot operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">Cohort-only metrics · mark shops on their profile.</p>
      </div>

      <AdminOperationalAlertsPanel previewMode={previewMode} />

      {loading && !metrics ? (
        <p className="text-sm text-muted-foreground">Loading pilot metrics…</p>
      ) : metrics ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <KpiPulseCard label="Total pilot shops" value={String(metrics.total_pilot_shops)} />
            <KpiPulseCard label="Active (24h)" value={String(metrics.active_pilot_shops)} accent />
            <KpiPulseCard label="At-risk" value={String(metrics.at_risk_pilot_shops)} />
            <KpiPulseCard label="Sync failures" value={String(metrics.shops_sync_failure)} />
            <KpiPulseCard label="Queue overload" value={String(metrics.shops_queue_overload)} />
            <KpiPulseCard label="Offline 24h+" value={String(metrics.shops_offline_24h)} />
            <KpiPulseCard label="Outdated app" value={String(metrics.shops_outdated_version)} />
            <KpiPulseCard
              label="Revenue 30d (UGX)"
              value={metrics.pilot_revenue_ugx_30d.toLocaleString("en-UG")}
            />
            <KpiPulseCard label="Crashes today" value={String(metrics.pilot_crashes_today)} />
          </div>
          <p className="text-xs font-semibold text-muted-foreground">Target version: {metrics.target_app_version}</p>
        </>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Apply migration 079 and mark shops as pilot cohort on shop profiles.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminCrashSummaryPanel previewMode={previewMode} />
        <AdminMigrationStatusPanel />
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-black text-foreground">Shop device diagnostics</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Engineering panels (migrations, sync queue, recovery) — not shown to shop owners.
        </p>
        <div className="mt-4">
          <DeveloperSystemHealthPanel lang="en" />
        </div>
      </section>

      <AdminDiagnosticsImportPanel previewMode={previewMode} />

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black text-foreground">Pilot shops</h2>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl bg-muted px-3 py-1.5 text-xs font-black text-muted-foreground"
          >
            Refresh
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            className="rounded-xl border border-border px-2 py-2 text-xs font-bold"
          >
            <option value="">All business types</option>
            {businessTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            className="rounded-xl border border-border px-2 py-2 text-xs font-bold"
          >
            <option value="">All plans</option>
            {plans.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}
            className="rounded-xl border border-border px-2 py-2 text-xs font-bold"
          >
            <option value="all">All status</option>
            <option value="active">Active only</option>
            <option value="inactive">Suspended</option>
          </select>
          <select
            value={syncFilter}
            onChange={(e) => setSyncFilter(e.target.value)}
            className="rounded-xl border border-border px-2 py-2 text-xs font-bold"
          >
            <option value="">All sync health</option>
            <option value="failure">Sync failure</option>
            <option value="queue">Queue overload</option>
            <option value="offline">Offline 24h+</option>
            <option value="outdated">Outdated version</option>
          </select>
        </div>

        <ul className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto">
          {shops.length === 0 ? (
            <li className="py-6 text-center text-sm font-semibold text-muted-foreground">
              No pilot shops match. Enable pilot cohort on shop profiles.
            </li>
          ) : (
            shops.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => navigate(internalAdminShopHref(s.id, previewMode))}
                  className="flex w-full flex-col gap-1 rounded-xl border border-border bg-muted px-3 py-3 text-left active:bg-muted"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black text-foreground">{s.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${HEALTH_CLS[s.health_status] ?? HEALTH_CLS.healthy}`}>
                      {s.health_status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s.business_type ?? "—"} · {s.plan_code ?? "free"} · risk {s.risk_score}
                    {s.pending_outbound > 0 ? ` · pending ${s.pending_outbound}` : ""}
                  </p>
                  {perms.canShopSupport && !previewMode ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        void adminSetShopPilotCohort(s.id, false).then(() => void load());
                      }}
                      onKeyDown={() => undefined}
                      className="text-[10px] font-bold text-rose-700 underline"
                    >
                      Remove from pilot cohort
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
