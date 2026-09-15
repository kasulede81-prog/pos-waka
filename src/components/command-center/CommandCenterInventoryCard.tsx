import { Link } from "react-router-dom";
import { AlertTriangle, Box, Package, PackageX, TrendingDown } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerInventoryExtended } from "../../lib/ownerCommandCenterBuilders";
import { formatShortUgx } from "../../lib/commandCenterPageView";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { EnterpriseKpiCard } from "../enterprise/EnterpriseKpiCard";
import { Caption } from "../enterprise/EnterpriseTypography";
import { WakaButton } from "../ui/wakaPrimitives";
import { statusTokens } from "../../lib/statusTokens";
import clsx from "clsx";

type Props = {
  lang: Language;
  inventory: OwnerInventoryExtended;
};

export function CommandCenterInventoryCard({ lang, inventory }: Props) {
  const accuracyPct =
    inventory.countVarianceCount === 0 && inventory.negativeStock.length === 0
      ? 99
      : Math.max(0, 100 - inventory.countVarianceCount * 5 - inventory.negativeStock.length * 3);

  return (
    <EnterpriseCard
      title={t(lang, "cmdCenterInventoryTitle")}
      subtitle={t(lang, "ownerInventoryRiskTitle")}
      actions={
        <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-black", statusTokens.success.badge)}>
          {accuracyPct}% {t(lang, "cmdCenterAccuracy")}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <EnterpriseKpiCard icon={Package} label={t(lang, "ownerInventoryValue")} value={formatShortUgx(inventory.inventoryValueUgx)} />
        <EnterpriseKpiCard
          icon={AlertTriangle}
          label={t(lang, "ownerInventoryNegative")}
          value={String(inventory.negativeStock.length)}
          tone={inventory.negativeStock.length > 0 ? "danger" : "default"}
        />
        <EnterpriseKpiCard
          icon={TrendingDown}
          label={t(lang, "ownerInventoryLow")}
          value={String(inventory.lowStockCount)}
          tone={inventory.lowStockCount > 0 ? "warning" : "default"}
        />
        <EnterpriseKpiCard
          icon={PackageX}
          label={t(lang, "ownerInventoryOos")}
          value={String(inventory.outOfStockCount)}
          tone={inventory.outOfStockCount > 0 ? "danger" : "default"}
        />
        <EnterpriseKpiCard icon={Box} label={t(lang, "ownerInventoryCountPending")} value={String(inventory.pendingCountSessions.length)} />
        <EnterpriseKpiCard icon={TrendingDown} label={t(lang, "cmdCenterDeadStock")} value={String(inventory.slowMovers.length)} />
      </div>

      {inventory.fastMovers.length > 0 ? (
        <Caption className="mt-3">
          {t(lang, "ownerInventoryFastMovers")}: {inventory.fastMovers.slice(0, 2).map((m) => m.name).join(", ")}
        </Caption>
      ) : null}

      <Link to="/stock" className="mt-4 block">
        <WakaButton type="button" variant="secondary" className="w-full">
          {t(lang, "cmdCenterOpenInventory")} →
        </WakaButton>
      </Link>
    </EnterpriseCard>
  );
}
