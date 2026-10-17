import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { StationProductionDashboard } from "../../lib/kitchenProduction";

type Props = {
  lang: Language;
  dashboard: StationProductionDashboard;
};

export function ProductionStationDashboard({ lang, dashboard }: Props) {
  const cells = [
    { label: t(lang, "productionDashPending"), value: dashboard.pendingTickets },
    { label: t(lang, "productionDashPreparing"), value: dashboard.preparingCount },
    { label: t(lang, "productionDashReady"), value: dashboard.readyCount },
    {
      label: t(lang, "productionDashAvgPrep"),
      value: dashboard.averagePrepMinutes != null ? `${dashboard.averagePrepMinutes}m` : "—",
    },
    {
      label: t(lang, "productionDashLongestWait"),
      value: dashboard.longestWaitMinutes != null ? `${dashboard.longestWaitMinutes}m` : "—",
    },
    { label: t(lang, "productionDashCompletedToday"), value: dashboard.completedToday },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((cell) => (
        <div key={cell.label} className="rounded-2xl border border-orange-100 bg-[#fffdfa] px-3 py-3 shadow-[0_8px_24px_rgba(77,48,27,0.05)] dark:border-orange-950/40 dark:bg-stone-900">
          <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{cell.label}</p>
          <p className="mt-0.5 text-lg font-black text-foreground">{cell.value}</p>
        </div>
      ))}
    </div>
  );
}
