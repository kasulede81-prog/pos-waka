import { Activity, AlertTriangle, Package, PackageX, Wallet } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { formatShortUgx } from "../../../features/inventory-purchasing/lib/overviewStats";
import type { InventoryWorkspaceDashboardStats } from "../../../lib/inventoryWorkspaceStats";
import { MonoNumber } from "../../enterprise/EnterpriseTypography";

type Props = {
  lang: Language;
  stats: InventoryWorkspaceDashboardStats;
  showInventoryValue?: boolean;
  onLowStock?: () => void;
  onOutOfStock?: () => void;
};

/** Presentation-only health scene — existing dashboard stats, no new calculations. */
export function InventoryHealthSnapshot({
  lang,
  stats,
  showInventoryValue = true,
  onLowStock,
  onOutOfStock,
}: Props) {
  const low = stats.lowStockCount > 0;
  const out = stats.outOfStockCount > 0;

  return (
    <section className="inventory-snapshot" aria-label={t(lang, "iwSectionHealth")}>
      <h2 className="inventory-snapshot__title">
        <Activity className="h-5 w-5" aria-hidden />
        {t(lang, "iwSectionHealth")}
      </h2>
      <div className="inventory-snapshot__metrics">
        <div className="inventory-snapshot__metric inventory-snapshot__metric--dominant">
          <span className="inventory-snapshot__metric-head">
            <Package className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="inventory-snapshot__label">{t(lang, "stockStatTotalProducts")}</span>
          </span>
          <MonoNumber className="inventory-snapshot__value">{stats.totalProducts}</MonoNumber>
        </div>
        <button
          type="button"
          className={clsx(
            "inventory-snapshot__metric",
            low ? "inventory-snapshot__metric--low" : "inventory-snapshot__metric--ok",
          )}
          onClick={onLowStock}
        >
          <span className="inventory-snapshot__metric-head">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <span className="inventory-snapshot__label">{t(lang, "ipStatLowStock")}</span>
          </span>
          <MonoNumber className="inventory-snapshot__value">{stats.lowStockCount}</MonoNumber>
        </button>
        <button
          type="button"
          className={clsx(
            "inventory-snapshot__metric",
            out ? "inventory-snapshot__metric--out" : "inventory-snapshot__metric--ok",
          )}
          onClick={onOutOfStock}
        >
          <span className="inventory-snapshot__metric-head">
            <PackageX className="h-4 w-4" aria-hidden />
            <span className="inventory-snapshot__label">{t(lang, "iwStatOutOfStock")}</span>
          </span>
          <MonoNumber className="inventory-snapshot__value">{stats.outOfStockCount}</MonoNumber>
        </button>
        <div className="inventory-snapshot__metric inventory-snapshot__metric--value">
          <span className="inventory-snapshot__metric-head">
            <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="inventory-snapshot__label">{t(lang, "stockStatValueShort")}</span>
          </span>
          <MonoNumber className="inventory-snapshot__value">
            {showInventoryValue ? formatShortUgx(stats.inventoryValueUgx) : "—"}
          </MonoNumber>
        </div>
      </div>
    </section>
  );
}
