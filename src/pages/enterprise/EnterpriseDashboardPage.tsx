import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
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

  useEffect(() => {
    void (async () => {
      const ctx = auth.user?.id ? await resolveEnterpriseOrganizationContext(auth.user.id) : null;
      if (ctx?.isSingleBranch) {
        setBranchNote(t(lang, "enterpriseSingleBranchNote"));
      }
      const m = await fetchEnterpriseDashboardMetrics();
      setMetrics(m.ok ? m : EMPTY);
    })();
  }, [auth.user?.id, lang]);

  const growth = branchGrowthScore(metrics);

  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_dashboard")} subtitle={t(lang, "enterpriseDashboardSub")}>
      {branchNote ? (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-950">
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

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase text-stone-500">{t(lang, "enterpriseRecentAudits")}</h2>
          <ul className="mt-3 space-y-2">
            {metrics.recentAudits.length === 0 ? (
              <li className="text-sm font-medium text-stone-500">{t(lang, "enterpriseNoData")}</li>
            ) : (
              metrics.recentAudits.slice(0, 8).map((row) => (
                <li key={row.id} className="rounded-xl border border-stone-100 px-3 py-2 text-sm">
                  <p className="font-bold text-stone-900">{row.summary || row.action}</p>
                  <p className="text-xs font-medium text-stone-500">{new Date(row.at).toLocaleString()}</p>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase text-stone-500">{t(lang, "enterpriseAlertsTitle")}</h2>
          <ul className="mt-3 space-y-2 text-sm font-semibold text-stone-700">
            <li>{t(lang, "enterpriseAlert_offlineBranches")}: {metrics.branchesOffline}</li>
            <li>{t(lang, "enterpriseAlert_devices")}: {metrics.pendingSyncDevices}</li>
            <li>{t(lang, "enterpriseAlert_lowStock")}: {metrics.lowStockBranches}</li>
            <li>{t(lang, "enterpriseAlert_expiry")}: {metrics.nearExpiryAlerts}</li>
            <li>{t(lang, "enterpriseAlert_controlled")}: {metrics.controlledMedicineAlerts}</li>
          </ul>
        </section>
      </div>
    </EnterpriseShell>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-stone-950">{value}</p>
      {hint ? <p className="text-xs font-medium text-stone-500">{hint}</p> : null}
    </div>
  );
}
