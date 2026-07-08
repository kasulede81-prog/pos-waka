import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Boxes,
  CreditCard,
  Package,
  Pill,
  Receipt,
  Shield,
  ShoppingCart,
  Users,
} from "lucide-react";
import type { Language } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { formatShortUgx } from "../../../features/inventory-purchasing/lib/overviewStats";
import type { InventoryWorkspaceDashboardStats } from "../../../lib/inventoryWorkspaceStats";
import type { InventoryWorkspaceMode } from "../../../lib/inventoryWorkspaceTiles";

type Props = {
  lang: Language;
  mode: InventoryWorkspaceMode;
  stats: InventoryWorkspaceDashboardStats;
  onLowStock?: () => void;
  onOutOfStock?: () => void;
  onPendingPurchases?: () => void;
  onTodayPurchases?: () => void;
  onSuppliers?: () => void;
  onInventoryAlerts?: () => void;
  onNearExpiry?: () => void;
  onExpired?: () => void;
  onBatchIntegrity?: () => void;
  onControlledAlerts?: () => void;
};

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  warn,
  highlight,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
  highlight?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={clsx(
        "flex min-h-[88px] flex-col justify-between rounded-2xl border p-3 text-left shadow-sm transition-all",
        highlight ? "border-waka-200 bg-gradient-to-br from-waka-50 to-waka-50/60" : "border-stone-200/90 bg-white",
        warn && !highlight && "border-rose-100 bg-rose-50/40",
        onClick && "active:scale-[0.98] motion-reduce:active:scale-100",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            "flex h-8 w-8 items-center justify-center rounded-xl",
            highlight ? "bg-waka-600 text-white" : warn ? "bg-rose-100 text-rose-700" : "bg-stone-100 text-stone-600",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-stone-500">{label}</span>
      </div>
      <div>
        <p className={clsx("text-lg font-black tabular-nums", warn ? "text-rose-800" : highlight ? "text-waka-800" : "text-stone-950")}>
          {value}
        </p>
        {hint ? <p className="text-[10px] font-semibold text-stone-500">{hint}</p> : null}
      </div>
    </Tag>
  );
}

export function InventoryDashboardCards({
  lang,
  mode,
  stats,
  onLowStock,
  onOutOfStock,
  onPendingPurchases,
  onTodayPurchases,
  onSuppliers,
  onInventoryAlerts,
  onNearExpiry,
  onExpired,
  onBatchIntegrity,
  onControlledAlerts,
}: Props) {
  const shared = (
    <>
      <StatCard
        icon={Package}
        label={t(lang, "stockStatTotalProducts")}
        value={String(stats.totalProducts)}
        highlight
      />
      <StatCard
        icon={Boxes}
        label={t(lang, "stockStatValueShort")}
        value={formatShortUgx(stats.inventoryValueUgx)}
        hint={t(lang, "stockStatValueHint")}
      />
      <StatCard
        icon={AlertTriangle}
        label={t(lang, "ipStatLowStock")}
        value={String(stats.lowStockCount)}
        hint={t(lang, "ipStatLowStockHint")}
        warn={stats.lowStockCount > 0}
        onClick={onLowStock}
      />
      <StatCard
        icon={Package}
        label={t(lang, "iwStatOutOfStock")}
        value={String(stats.outOfStockCount)}
        warn={stats.outOfStockCount > 0}
        onClick={onOutOfStock}
      />
      <StatCard
        icon={Receipt}
        label={t(lang, "ipStatOpenOrders")}
        value={String(stats.pendingPurchases)}
        onClick={onPendingPurchases}
      />
      <StatCard
        icon={ShoppingCart}
        label={t(lang, "iwStatTodayPurchases")}
        value={formatShortUgx(stats.todayPurchasesUgx)}
        hint={
          stats.todayPurchaseCount > 0
            ? tTemplate(lang, "iwStatTodayPurchasesHint", { count: String(stats.todayPurchaseCount) })
            : undefined
        }
        onClick={onTodayPurchases}
      />
      <StatCard
        icon={Users}
        label={t(lang, "ipStatActiveSuppliers")}
        value={String(stats.activeSuppliers)}
        onClick={onSuppliers}
      />
      <StatCard
        icon={CreditCard}
        label={t(lang, "iwStatInventoryAlerts")}
        value={String(stats.inventoryAlerts)}
        warn={stats.inventoryAlerts > 0}
        onClick={onInventoryAlerts}
      />
    </>
  );

  const pharmacyExtras =
    mode === "pharmacy" ? (
      <>
        <StatCard
          icon={Pill}
          label={t(lang, "iwStatNearExpiry")}
          value={String(stats.nearExpiryCount)}
          warn={stats.nearExpiryCount > 0}
          onClick={onNearExpiry}
        />
        <StatCard
          icon={AlertTriangle}
          label={t(lang, "iwStatExpired")}
          value={String(stats.expiredCount)}
          warn={stats.expiredCount > 0}
          onClick={onExpired}
        />
        <StatCard
          icon={Shield}
          label={t(lang, "iwExtBatchIntegrity")}
          value={String(stats.batchIntegrityIssues)}
          warn={stats.batchIntegrityIssues > 0}
          onClick={onBatchIntegrity}
        />
        <StatCard
          icon={Shield}
          label={t(lang, "iwStatControlledAlerts")}
          value={String(stats.controlledAlerts)}
          warn={stats.controlledAlerts > 0}
          onClick={onControlledAlerts}
        />
      </>
    ) : null;

  return (
    <section className="space-y-2">
      <h3 className="px-0.5 text-[10px] font-black uppercase tracking-wide text-stone-500">
        {t(lang, "iwSectionDashboard")}
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {shared}
        {pharmacyExtras}
      </div>
    </section>
  );
}
