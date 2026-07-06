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
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((cell) => (
        <div key={cell.label} className="rounded-xl border border-stone-200 bg-white px-3 py-2">
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{cell.label}</p>
          <p className="mt-0.5 text-lg font-black text-stone-950">{cell.value}</p>
        </div>
      ))}
    </div>
  );
}
