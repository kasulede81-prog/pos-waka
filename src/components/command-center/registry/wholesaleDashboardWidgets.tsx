import { Link } from "react-router-dom";
import { t } from "../../../lib/i18n";
import { formatUgx } from "../../../lib/formatUgx";
import { VerticalDashboardCard, VerticalDashboardPanel } from "../VerticalDashboardCard";
import type { DashboardWidgetDef, DashboardWidgetProps } from "./dashboardWidgetTypes";

const WHOLESALE_CMD = (ctx: DashboardWidgetProps["ctx"]) =>
  ctx.surface === "command-center" && ctx.mode === "wholesale";

function WholesaleKpiStripWidget({ ctx }: DashboardWidgetProps) {
  if (!WHOLESALE_CMD(ctx) || !ctx.commandCenter) return null;
  const fin = ctx.commandCenter.financial;
  const inv = ctx.commandCenter.inventory;
  return (
    <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 xl:grid-cols-4">
      <VerticalDashboardCard
        label={t(ctx.lang, "wholesaleDashReceivables")}
        value={formatUgx(fin.receivablesUgx)}
        tone="amber"
      />
      <VerticalDashboardCard
        label={t(ctx.lang, "officeSupplierSummaryTitle")}
        value={formatUgx(fin.payablesUgx)}
        tone="violet"
      />
      <VerticalDashboardCard
        label={t(ctx.lang, "wholesaleDashLargeInvoices")}
        value={String(ctx.commandCenter.overview.transactionCount)}
        hint={ctx.periodLabel}
        tone="sky"
      />
      <VerticalDashboardCard
        label={t(ctx.lang, "wholesaleDashReorderRequired")}
        value={String(inv.lowStockCount + inv.outOfStockCount)}
        tone="emerald"
      />
    </div>
  );
}

function WholesaleOperationsWidget({ ctx }: DashboardWidgetProps) {
  if (!WHOLESALE_CMD(ctx) || !ctx.commandCenter) return null;
  const ops = ctx.commandCenter.liveOps;
  const pendingSync = ops.unsyncedOperations;
  return (
    <VerticalDashboardPanel title={t(ctx.lang, "wholesaleDashTitle")}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <VerticalDashboardCard label={t(ctx.lang, "wholesaleDashPurchaseOrders")} value={String(pendingSync)} tone="default" />
        <VerticalDashboardCard label={t(ctx.lang, "wholesaleDashDeliveries")} value={String(ops.pendingQueueOps)} tone="default" />
        <VerticalDashboardCard label={t(ctx.lang, "wholesaleDashLargeInvoices")} value={String(ctx.commandCenter.overview.transactionCount)} tone="default" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to="/stock?tab=purchases" className="rounded-xl bg-waka-600 px-4 py-2 text-xs font-black text-white">
          {t(ctx.lang, "wholesaleDashGoWarehouse")}
        </Link>
        <Link to="/reports" className="rounded-xl border border-border px-4 py-2 text-xs font-black text-foreground">
          {t(ctx.lang, "wholesaleDashGoReports")}
        </Link>
        <Link to="/customers" className="rounded-xl border border-border px-4 py-2 text-xs font-black text-foreground">
          {t(ctx.lang, "wholesaleDashReceivables")}
        </Link>
      </div>
    </VerticalDashboardPanel>
  );
}

function WholesaleCreditWidget({ ctx }: DashboardWidgetProps) {
  if (!WHOLESALE_CMD(ctx) || !ctx.commandCenter) return null;
  return (
    <VerticalDashboardPanel title={t(ctx.lang, "wholesaleDashCustomerCredit")}>
      <VerticalDashboardCard
        label={t(ctx.lang, "wholesaleDashLargestDebtor")}
        value={formatUgx(ctx.commandCenter.financial.receivablesUgx)}
        hint={t(ctx.lang, "wholesaleDashReceivables")}
      />
      <Link to="/customers" className="mt-3 inline-flex text-sm font-bold text-waka-700">
        {t(ctx.lang, "cmdCenterRecDebtsAction")} →
      </Link>
    </VerticalDashboardPanel>
  );
}

function WholesaleStockWidget({ ctx }: DashboardWidgetProps) {
  if (!WHOLESALE_CMD(ctx) || !ctx.commandCenter) return null;
  const inv = ctx.commandCenter.inventory;
  const low = inv.lowStockCount;
  const out = inv.outOfStockCount;
  return (
    <VerticalDashboardPanel title={t(ctx.lang, "wholesaleDashStockMovement")}>
      <div className="grid grid-cols-2 gap-3">
        <VerticalDashboardCard label={t(ctx.lang, "cardLowStock")} value={String(low)} tone="amber" />
        <VerticalDashboardCard label={t(ctx.lang, "iwStatOutOfStock")} value={String(out)} tone="default" />
      </div>
      <Link to="/stock" className="mt-3 inline-flex text-sm font-bold text-waka-700">
        {t(ctx.lang, "navStock")} →
      </Link>
    </VerticalDashboardPanel>
  );
}

/** Wholesale command center extensions — receivables, purchases, inventory. */
export const WHOLESALE_DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  {
    id: "wholesale-kpi-strip",
    slot: "kpi-grid",
    priority: 100,
    businessTypes: ["wholesale"],
    visible: WHOLESALE_CMD,
    Component: WholesaleKpiStripWidget,
  },
  {
    id: "wholesale-operations",
    slot: "live-operations",
    priority: 100,
    businessTypes: ["wholesale"],
    visible: WHOLESALE_CMD,
    Component: WholesaleOperationsWidget,
  },
  {
    id: "wholesale-receivables",
    slot: "financial",
    priority: 100,
    businessTypes: ["wholesale"],
    visible: WHOLESALE_CMD,
    Component: WholesaleCreditWidget,
  },
  {
    id: "wholesale-stock",
    slot: "inventory",
    priority: 100,
    businessTypes: ["wholesale"],
    visible: WHOLESALE_CMD,
    Component: WholesaleStockWidget,
  },
];
