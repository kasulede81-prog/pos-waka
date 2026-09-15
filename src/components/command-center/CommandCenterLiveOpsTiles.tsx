import { Link } from "react-router-dom";
import { Activity, Banknote, Monitor, Users, Wallet } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerLiveOperationsSnapshot } from "../../lib/ownerCommandCenterBuilders";
import { formatShortUgx } from "../../lib/commandCenterPageView";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { EnterpriseKpiCard } from "../enterprise/EnterpriseKpiCard";
import { WakaButton } from "../ui/wakaPrimitives";

type Props = {
  lang: Language;
  live: OwnerLiveOperationsSnapshot;
  expectedCashUgx: number;
};

export function CommandCenterLiveOpsTiles({ lang, live, expectedCashUgx }: Props) {
  const queueWarn = live.unsyncedOperations > 0 || live.devicesStale > 0;

  return (
    <EnterpriseCard
      title={t(lang, "ownerLiveOpsTitle")}
      subtitle={t(lang, "ownerLiveOpsSub")}
      actions={
        <Link to="/office/open-shifts" className="text-[11px] font-black text-waka-700">
          {t(lang, "ownerShiftViewAll")} →
        </Link>
      }
      muted
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <EnterpriseKpiCard icon={Activity} label={t(lang, "ownerLiveOpsOpenShifts")} value={String(live.openShiftCount)} />
        <EnterpriseKpiCard icon={Users} label={t(lang, "ownerLiveOpsCashiers")} value={String(live.activeCashierCount)} />
        <EnterpriseKpiCard icon={Monitor} label={t(lang, "ownerLiveOpsDevicesOnline")} value={String(live.devicesOnline)} />
        <EnterpriseKpiCard
          icon={Wallet}
          label={t(lang, "ownerLiveOpsDrawer")}
          value={live.dayDrawerOpen ? t(lang, "ownerCashDrawerOpenYes") : t(lang, "ownerCashDrawerOpenNo")}
        />
        <EnterpriseKpiCard icon={Banknote} label={t(lang, "cmdCenterKpiExpectedCash")} value={formatShortUgx(expectedCashUgx)} />
        <EnterpriseKpiCard
          icon={Activity}
          label={t(lang, "ownerLiveOpsUnsynced")}
          value={String(live.unsyncedOperations)}
          tone={queueWarn ? "warning" : "default"}
        />
      </div>
      <Link to="/office/open-shifts" className="mt-3 block sm:hidden">
        <WakaButton type="button" variant="secondary" className="w-full">
          {t(lang, "ownerShiftViewAll")} →
        </WakaButton>
      </Link>
    </EnterpriseCard>
  );
}
