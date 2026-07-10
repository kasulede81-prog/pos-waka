import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import { useInternalOpsData } from "../../../../hooks/useInternalOpsData";
import { adminKpiGridClass } from "../../../../lib/desktopLayout";
import { AppVersionPanel, PlatformAnalyticsPanel } from "../ops/OpsWidgets";
import { KpiPulseCard } from "../primitives";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode: boolean;
};

export function AdminAnalyticsPage({ adminRow, previewMode }: Props) {
  const data = useInternalOpsData(adminRow, previewMode, "analytics");

  const churnHint =
    data.stats && data.stats.totalShops > 0
      ? Math.round(((data.stats.suspendedShops + data.stats.expiredSubscriptions) / data.stats.totalShops) * 100)
      : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-stone-900">Platform analytics</h1>
        <p className="text-sm text-stone-500">Growth & health trends · see Dashboard for live ops status</p>
      </div>

      <div className={adminKpiGridClass()}>
        <KpiPulseCard label="Paid subs" value={data.statGrid.paid} />
        <KpiPulseCard label="Trials" value={data.statGrid.trial} accent />
        <KpiPulseCard label="Churn signal %" value={`${churnHint}%`} />
        <KpiPulseCard label="Sales (UGX)" value={data.statGrid.sales} accent />
      </div>

      {data.opsLoading && data.signups7.length === 0 ? (
        <div className="space-y-3">
          <div className="h-36 animate-pulse rounded-2xl bg-stone-200" />
          <div className="h-28 animate-pulse rounded-2xl bg-stone-200" />
        </div>
      ) : null}

      <PlatformAnalyticsPanel signups7={data.signups7} subs7={data.subs7} districts={data.districts} />

      <AppVersionPanel versions={data.appVersions} />
    </div>
  );
}
