import { useInternalOpsData } from "../../../../hooks/useInternalOpsData";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import { KpiPulseCard } from "../primitives";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode: boolean;
};

export function AdminPilotPage({ adminRow, previewMode }: Props) {
  const data = useInternalOpsData(adminRow, previewMode, "overview");
  const stats = data.stats;
  const tickets = data.tickets;
  const fleet = data.fleetDevices;

  const openTickets = tickets.filter((ticket) => ticket.status === "open" || ticket.status === "in_progress").length;
  const devicesWithErrors = fleet.filter((device) => (device as { sync_error_count?: number }).sync_error_count).length;
  const syncErrorRate =
    fleet.length > 0 ? Math.round((devicesWithErrors / fleet.length) * 100) : stats?.openSupportTickets ? 0 : 0;

  const avgDailySales =
    stats?.salesTotalUgx != null && stats.activeToday > 0
      ? Math.round(stats.salesTotalUgx / Math.max(1, stats.activeToday))
      : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black text-stone-900">Pilot success</h1>
        <p className="mt-1 text-sm text-stone-600">Read-only cohort health for active pilot shops.</p>
      </div>

      {data.statsError ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          {data.statsErrorMessage || "Could not load pilot metrics."}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiPulseCard label="Pilot shops (total)" value={String(stats?.totalShops ?? "—")} />
        <KpiPulseCard label="Active today" value={String(stats?.activeToday ?? "—")} accent />
        <KpiPulseCard label="Shops online now" value={String(stats?.shopsOnlineNow ?? "—")} accent />
        <KpiPulseCard label="Open support tickets" value={String(openTickets || stats?.openSupportTickets || 0)} />
        <KpiPulseCard label="Fleet sync error rate" value={fleet.length ? `${syncErrorRate}%` : "—"} />
        <KpiPulseCard
          label="Avg daily sales (UGX)"
          value={avgDailySales != null ? avgDailySales.toLocaleString() : "—"}
        />
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-4">
        <p className="text-sm font-black text-stone-900">Notes</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-600">
          <li>Crash rate requires Sentry dashboard (not in-app).</li>
          <li>Sync error rate = devices reporting sync errors ÷ fleet size.</li>
          <li>Target pilot cohort: 5–10 shops, single register, owner-supervised.</li>
        </ul>
      </section>
    </div>
  );
}
