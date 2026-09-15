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
import { EnterpriseKpiCard } from "../../enterprise/EnterpriseKpiCard";
import { enterpriseTypeClass } from "../../../lib/enterpriseTypography";
import { enterpriseSpace } from "../../../lib/enterpriseSpacing";

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
      <EnterpriseKpiCard
        icon={Package}
        label={t(lang, "stockStatTotalProducts")}
        value={String(stats.totalProducts)}
        tone="highlight"
      />
      <EnterpriseKpiCard
        icon={Boxes}
        label={t(lang, "stockStatValueShort")}
        value={formatShortUgx(stats.inventoryValueUgx)}
        hint={t(lang, "stockStatValueHint")}
      />
      <EnterpriseKpiCard
        icon={AlertTriangle}
        label={t(lang, "ipStatLowStock")}
        value={String(stats.lowStockCount)}
        hint={t(lang, "ipStatLowStockHint")}
        tone={stats.lowStockCount > 0 ? "danger" : "default"}
        onClick={onLowStock}
      />
      <EnterpriseKpiCard
        icon={Package}
        label={t(lang, "iwStatOutOfStock")}
        value={String(stats.outOfStockCount)}
        tone={stats.outOfStockCount > 0 ? "danger" : "default"}
        onClick={onOutOfStock}
      />
      <EnterpriseKpiCard
        icon={Receipt}
        label={t(lang, "ipStatOpenOrders")}
        value={String(stats.pendingPurchases)}
        onClick={onPendingPurchases}
      />
      <EnterpriseKpiCard
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
      <EnterpriseKpiCard
        icon={Users}
        label={t(lang, "ipStatActiveSuppliers")}
        value={String(stats.activeSuppliers)}
        onClick={onSuppliers}
      />
      <EnterpriseKpiCard
        icon={CreditCard}
        label={t(lang, "iwStatInventoryAlerts")}
        value={String(stats.inventoryAlerts)}
        tone={stats.inventoryAlerts > 0 ? "warning" : "default"}
        onClick={onInventoryAlerts}
      />
    </>
  );

  const pharmacyExtras =
    mode === "pharmacy" ? (
      <>
        <EnterpriseKpiCard
          icon={Pill}
          label={t(lang, "iwStatNearExpiry")}
          value={String(stats.nearExpiryCount)}
          tone={stats.nearExpiryCount > 0 ? "warning" : "default"}
          onClick={onNearExpiry}
        />
        <EnterpriseKpiCard
          icon={AlertTriangle}
          label={t(lang, "iwStatExpired")}
          value={String(stats.expiredCount)}
          tone={stats.expiredCount > 0 ? "danger" : "default"}
          onClick={onExpired}
        />
        <EnterpriseKpiCard
          icon={Shield}
          label={t(lang, "iwExtBatchIntegrity")}
          value={String(stats.batchIntegrityIssues)}
          tone={stats.batchIntegrityIssues > 0 ? "danger" : "default"}
          onClick={onBatchIntegrity}
        />
        <EnterpriseKpiCard
          icon={Shield}
          label={t(lang, "iwStatControlledAlerts")}
          value={String(stats.controlledAlerts)}
          tone={stats.controlledAlerts > 0 ? "warning" : "default"}
          onClick={onControlledAlerts}
        />
      </>
    ) : null;

  return (
    <section className={enterpriseSpace.workspaceStack}>
      <h3 className={enterpriseTypeClass("caption")}>{t(lang, "iwSectionDashboard")}</h3>
      <div className={`${enterpriseSpace.kpiGrid} grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`}>
        {shared}
        {pharmacyExtras}
      </div>
    </section>
  );
}
