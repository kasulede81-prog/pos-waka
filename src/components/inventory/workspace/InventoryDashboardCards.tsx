import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CreditCard,
  Pill,
  Receipt,
  Shield,
  ShoppingCart,
  Users,
} from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { formatShortUgx } from "../../../features/inventory-purchasing/lib/overviewStats";
import type { InventoryWorkspaceDashboardStats } from "../../../lib/inventoryWorkspaceStats";
import type { InventoryWorkspaceMode } from "../../../lib/inventoryWorkspaceTiles";
import { MonoNumber } from "../../enterprise/EnterpriseTypography";
import { InventoryHealthSnapshot } from "./InventoryHealthSnapshot";

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
  showInventoryValue?: boolean;
};

type OpsTone = "default" | "warning" | "danger";

function OpsMetric({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: OpsTone;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx("inventory-ops-metric", tone !== "default" && `inventory-ops-metric--${tone}`)}
      onClick={onClick}
    >
      <span className="inventory-ops-icon">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="inventory-ops-copy">
        <span className="inventory-ops-label">{label}</span>
        <MonoNumber className="inventory-ops-value">{value}</MonoNumber>
        {hint ? <span className="inventory-ops-hint">{hint}</span> : null}
      </span>
    </button>
  );
}

export function InventoryDashboardCards({
  lang,
  stats,
  onLowStock,
  onOutOfStock,
  showInventoryValue = true,
}: Pick<Props, "lang" | "stats" | "onLowStock" | "onOutOfStock" | "showInventoryValue">) {
  return (
    <InventoryHealthSnapshot
      lang={lang}
      stats={stats}
      showInventoryValue={showInventoryValue}
      onLowStock={onLowStock}
      onOutOfStock={onOutOfStock}
    />
  );
}

export function InventoryOpsBoard({
  lang,
  mode,
  stats,
  onPendingPurchases,
  onTodayPurchases,
  onSuppliers,
  onInventoryAlerts,
  onNearExpiry,
  onExpired,
  onBatchIntegrity,
  onControlledAlerts,
}: Omit<Props, "showInventoryValue" | "onLowStock" | "onOutOfStock">) {
  return (
      <section className="inventory-ops-board">
        <div className="inventory-ops-col">
          <h3 className="inventory-zone-label mb-1.5">{t(lang, "ipTabPurchases")}</h3>
          <div className="inventory-ops-metrics">
            <OpsMetric
              icon={Receipt}
              label={t(lang, "ipStatOpenOrders")}
              value={String(stats.pendingPurchases)}
              onClick={onPendingPurchases}
            />
            <OpsMetric
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
          </div>
        </div>
        <div className="inventory-ops-col">
          <h3 className="inventory-zone-label mb-1.5">{t(lang, "ipTabSuppliers")}</h3>
          <div className="inventory-ops-metrics">
            <OpsMetric
              icon={Users}
              label={t(lang, "ipStatActiveSuppliers")}
              value={String(stats.activeSuppliers)}
              onClick={onSuppliers}
            />
            <OpsMetric
              icon={AlertTriangle}
              label={t(lang, "iwStatInventoryAlerts")}
              value={String(stats.inventoryAlerts)}
              tone={stats.inventoryAlerts > 0 ? "warning" : "default"}
              onClick={onInventoryAlerts}
            />
          </div>
        </div>
        {mode === "pharmacy" ? (
          <div className="inventory-ops-col inventory-ops-col--wide">
            <h3 className="inventory-zone-label mb-1.5">{t(lang, "iwExtSectionPharmacy")}</h3>
            <div className="inventory-ops-metrics">
              <OpsMetric
                icon={Pill}
                label={t(lang, "iwStatNearExpiry")}
                value={String(stats.nearExpiryCount)}
                tone={stats.nearExpiryCount > 0 ? "warning" : "default"}
                onClick={onNearExpiry}
              />
              <OpsMetric
                icon={AlertTriangle}
                label={t(lang, "iwStatExpired")}
                value={String(stats.expiredCount)}
                tone={stats.expiredCount > 0 ? "danger" : "default"}
                onClick={onExpired}
              />
              <OpsMetric
                icon={Shield}
                label={t(lang, "iwExtBatchIntegrity")}
                value={String(stats.batchIntegrityIssues)}
                tone={stats.batchIntegrityIssues > 0 ? "danger" : "default"}
                onClick={onBatchIntegrity}
              />
              <OpsMetric
                icon={CreditCard}
                label={t(lang, "iwStatControlledAlerts")}
                value={String(stats.controlledAlerts)}
                tone={stats.controlledAlerts > 0 ? "warning" : "default"}
                onClick={onControlledAlerts}
              />
            </div>
          </div>
        ) : null}
      </section>
  );
}
