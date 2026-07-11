import { Link } from "react-router-dom";
import { t } from "../../../lib/i18n";
import { formatUgx } from "../../../lib/formatUgx";
import { dateKeyKampala } from "../../../lib/datesUg";
import {
  activeReservationCount,
  activeWaitlistCount,
  averageOpenTableMinutes,
} from "../../../lib/hospitalityStats";
import { activeProductionTickets } from "../../../lib/kitchenProduction";
import { VerticalDashboardCard, VerticalDashboardPanel } from "../VerticalDashboardCard";
import type { DashboardWidgetDef, DashboardWidgetProps } from "./dashboardWidgetTypes";

const HOSPITALITY_CMD = (ctx: DashboardWidgetProps["ctx"]) =>
  ctx.surface === "command-center" && ctx.mode === "hospitality";

function HospitalityKpiStripWidget({ ctx }: DashboardWidgetProps) {
  if (!HOSPITALITY_CMD(ctx) || !ctx.hospitalityStats) return null;
  const stats = ctx.hospitalityStats;
  return (
    <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 xl:grid-cols-4">
      <VerticalDashboardCard
        label={t(ctx.lang, "hospitalityDashOpenTables")}
        value={String(stats.openTables)}
        hint={`${stats.occupiedTables} ${t(ctx.lang, "hospitalityDashOccupiedTables").toLowerCase()}`}
        tone="emerald"
      />
      <VerticalDashboardCard
        label={t(ctx.lang, "hospitalityDashKitchenQueue")}
        value={String(stats.kitchenQueueCount)}
        tone="amber"
      />
      <VerticalDashboardCard
        label={t(ctx.lang, "hospitalityDashPendingBills")}
        value={formatUgx(stats.pendingBillsUgx)}
        hint={`${stats.pendingBillCount} open`}
        tone="violet"
      />
      <VerticalDashboardCard
        label={t(ctx.lang, "hospitalityDashTodayRevenue")}
        value={formatUgx(ctx.commandCenter?.overview.revenueUgx ?? 0)}
        hint={ctx.periodLabel}
        tone="sky"
      />
    </div>
  );
}

function HospitalityKitchenQueueWidget({ ctx }: DashboardWidgetProps) {
  if (!HOSPITALITY_CMD(ctx) || !ctx.hospitalityFloor) return null;
  const tickets = activeProductionTickets(ctx.hospitalityFloor).slice(0, 6);
  return (
    <VerticalDashboardPanel title={t(ctx.lang, "hospitalityDashKitchenQueue")}>
      {tickets.length === 0 ? (
        <p className="text-sm font-medium text-muted-foreground">{t(ctx.lang, "hospitalityDashNoKitchenQueue")}</p>
      ) : (
        <ul className="space-y-2">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-sm">
              <span className="font-bold text-foreground">{ticket.tableLabel ?? ticket.stationType}</span>
              <span className="font-semibold text-muted-foreground">{ticket.status}</span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/kitchen" className="mt-3 inline-flex text-sm font-bold text-waka-700">
        {t(ctx.lang, "hospitalityDashGoKitchen")} →
      </Link>
    </VerticalDashboardPanel>
  );
}

function HospitalityReservationsWidget({ ctx }: DashboardWidgetProps) {
  if (!HOSPITALITY_CMD(ctx) || !ctx.hospitalityFloor) return null;
  const todayKey = dateKeyKampala(new Date());
  const reservations = activeReservationCount(ctx.hospitalityFloor, todayKey);
  const waitlist = activeWaitlistCount(ctx.hospitalityFloor);
  return (
    <VerticalDashboardPanel title={t(ctx.lang, "hospitalityDashReservations")}>
      <div className="grid grid-cols-2 gap-3">
        <VerticalDashboardCard label={t(ctx.lang, "hospitalityDashReservationsToday")} value={String(reservations)} tone="default" />
        <VerticalDashboardCard label={t(ctx.lang, "hospitalityDashWaitlist")} value={String(waitlist)} tone="default" />
      </div>
      <Link to="/floor" className="mt-3 inline-flex text-sm font-bold text-waka-700">
        {t(ctx.lang, "hospitalityDashGoFloor")} →
      </Link>
    </VerticalDashboardPanel>
  );
}

function HospitalityWaitStaffWidget({ ctx }: DashboardWidgetProps) {
  if (!HOSPITALITY_CMD(ctx) || !ctx.hospitalityStats) return null;
  const waiters = ctx.hospitalityStats.activeWaiters;
  return (
    <VerticalDashboardPanel title={t(ctx.lang, "hospitalityDashWaitStaff")}>
      {waiters.length === 0 ? (
        <p className="text-sm font-medium text-muted-foreground">{t(ctx.lang, "hospitalityDashNoWaitStaff")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {waiters.map((name) => (
            <li key={name} className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-foreground">
              {name}
            </li>
          ))}
        </ul>
      )}
    </VerticalDashboardPanel>
  );
}

function HospitalityTableTimeWidget({ ctx }: DashboardWidgetProps) {
  if (!HOSPITALITY_CMD(ctx) || !ctx.hospitalityFloor) return null;
  const avg = averageOpenTableMinutes(ctx.hospitalityFloor);
  return (
    <VerticalDashboardCard
      label={t(ctx.lang, "hospitalityDashAvgTableTime")}
      value={avg == null ? "—" : `${avg} min`}
      hint={t(ctx.lang, "hospitalityDashAvgTableTimeHint")}
      tone="default"
    />
  );
}

/** Hospitality command center extensions — floor, kitchen, reservations, wait staff. */
export const HOSPITALITY_DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  {
    id: "hospitality-kpi-strip",
    slot: "kpi-grid",
    priority: 100,
    businessTypes: ["hospitality"],
    visible: HOSPITALITY_CMD,
    Component: HospitalityKpiStripWidget,
  },
  {
    id: "hospitality-kitchen-queue",
    slot: "live-operations",
    priority: 100,
    businessTypes: ["hospitality"],
    visible: HOSPITALITY_CMD,
    Component: HospitalityKitchenQueueWidget,
  },
  {
    id: "hospitality-table-time",
    slot: "live-operations",
    priority: 110,
    businessTypes: ["hospitality"],
    visible: HOSPITALITY_CMD,
    Component: HospitalityTableTimeWidget,
  },
  {
    id: "hospitality-reservations",
    slot: "attention",
    priority: 100,
    businessTypes: ["hospitality"],
    visible: HOSPITALITY_CMD,
    Component: HospitalityReservationsWidget,
  },
  {
    id: "hospitality-waiter-performance",
    slot: "staff",
    priority: 100,
    businessTypes: ["hospitality"],
    visible: HOSPITALITY_CMD,
    Component: HospitalityWaitStaffWidget,
  },
];
