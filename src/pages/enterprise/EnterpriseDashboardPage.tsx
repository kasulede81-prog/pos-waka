import { useCallback, useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
import { EnterpriseAsyncShell } from "../../components/enterprise/EnterpriseAsyncShell";
import { fetchEnterpriseDashboardMetrics, resolveEnterpriseOrganizationContext } from "../../lib/enterprise/organizationContext";
import type { EnterpriseDashboardMetrics } from "../../types/enterprise";
import { useAuth } from "../../hooks/useAuth";
import { branchGrowthScore } from "../../lib/enterprise/enterpriseAnalytics";

const EMPTY: EnterpriseDashboardMetrics = {
  ok: false,
  branchCount: 0,
  branchesOnline: 0,
  branchesOffline: 0,
  todaySalesUgx: 0,
  todayProfitUgx: 0,
  openShifts: 0,
  openBusinessDays: 0,
  pendingSyncDevices: 0,
  lowStockBranches: 0,
  nearExpiryAlerts: 0,
  controlledMedicineAlerts: 0,
  topBranches: [],
  recentAudits: [],
};

export function EnterpriseDashboardPage({ lang }: { lang: Language }) {
  const auth = useAuth();
  const [metrics, setMetrics] = useState<EnterpriseDashboardMetrics>(EMPTY);
  const [branchNote, setBranchNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const ctx = auth.user?.id ? await resolveEnterpriseOrganizationContext(auth.user.id) : null;
      if (ctx?.isSingleBranch) {
        setBranchNote(t(lang, "enterpriseSingleBranchNote"));
      } else {
        setBranchNote(null);
      }
      const m = await fetchEnterpriseDashboardMetrics();
      if (!m.ok) {
        setLoadError(m.error ?? t(lang, "notifyEnterpriseLoadFailed"));
        setMetrics(EMPTY);
      } else {
        setMetrics(m);
      }
    } catch {
      setLoadError(t(lang, "notifyEnterpriseLoadFailed"));
      setMetrics(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [auth.user?.id, lang]);

  useEffect(() => {
    void load();
  }, [load]);

  const growth = branchGrowthScore(metrics);

  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_dashboard")} subtitle={t(lang, "enterpriseDashboardSub")}>
      <EnterpriseAsyncShell
        loading={loading}
        error={loadError}
        emptyIcon={BarChart3}
        emptyTitle={t(lang, "enterpriseNoData")}
        errorTitle={t(lang, "notifyEnterpriseLoadFailed")}
        retryLabel={t(lang, "enterpriseRetry")}
        onRetry={() => void load()}
      >
        {branchNote ? (
          <p className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-950">
            {branchNote}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label={t(lang, "enterpriseMetric_sales")} value={formatUgx(metrics.todaySalesUgx)} />
          <MetricCard label={t(lang, "enterpriseMetric_profit")} value={formatUgx(metrics.todayProfitUgx)} />
          <MetricCard
            label={t(lang, "enterpriseMetric_branches")}
            value={`${metrics.branchesOnline}/${metrics.branchCount}`}
            hint={t(lang, "enterpriseMetric_online")}
          />
          <MetricCard label={t(lang, "enterpriseMetric_syncHealth")} value={`${growth}%`} />
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-black uppercase text-muted-foreground">{t(lang, "enterpriseRecentAudits")}</h2>
            <ul className="mt-3 space-y-2">
              {metrics.recentAudits.length === 0 ? (
                <li className="text-sm font-medium text-muted-foreground">{t(lang, "enterpriseNoData")}</li>
              ) : (
                metrics.recentAudits.slice(0, 8).map((row) => (
                  <li key={row.id} className="rounded-xl border border-border px-3 py-2 text-sm">
                    <p className="font-bold text-foreground">{row.summary || row.action}</p>
                    <p className="text-xs font-medium text-muted-foreground">{new Date(row.at).toLocaleString()}</p>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-black uppercase text-muted-foreground">{t(lang, "enterpriseAlertsTitle")}</h2>
            <ul className="mt-3 space-y-2 text-sm font-semibold text-muted-foreground">
              <li>
                {t(lang, "enterpriseAlert_offlineBranches")}: {metrics.branchesOffline}
              </li>
              <li>
                {t(lang, "enterpriseAlert_devices")}: {metrics.pendingSyncDevices}
              </li>
              <li>
                {t(lang, "enterpriseAlert_lowStock")}: {metrics.lowStockBranches}
              </li>
              <li>
                {t(lang, "enterpriseAlert_expiry")}: {metrics.nearExpiryAlerts}
              </li>
              <li>
                {t(lang, "enterpriseAlert_controlled")}: {metrics.controlledMedicineAlerts}
              </li>
            </ul>
          </section>
        </div>
      </EnterpriseAsyncShell>
    </EnterpriseShell>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-black uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-black text-foreground">{value}</p>
      {hint ? <p className="text-xs font-medium text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
