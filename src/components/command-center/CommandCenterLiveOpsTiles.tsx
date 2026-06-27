import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerLiveOperationsSnapshot } from "../../lib/ownerCommandCenterBuilders";
import { formatShortUgx } from "../../lib/commandCenterPageView";

type Props = {
  lang: Language;
  live: OwnerLiveOperationsSnapshot;
  expectedCashUgx: number;
};

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-2xl px-2.5 py-2.5 ${warn ? "bg-amber-50 ring-1 ring-amber-100" : "bg-white ring-1 ring-stone-100"}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">{label}</p>
      <p className={`mt-0.5 text-sm font-black tabular-nums ${warn ? "text-amber-900" : "text-stone-950"}`}>{value}</p>
    </div>
  );
}

export function CommandCenterLiveOpsTiles({ lang, live, expectedCashUgx }: Props) {
  const queueWarn = live.unsyncedOperations > 0 || live.devicesStale > 0;

  return (
    <section className="rounded-3xl border border-stone-200/90 bg-stone-50/50 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-stone-950 sm:text-base">{t(lang, "ownerLiveOpsTitle")}</h2>
          <p className="text-[11px] font-semibold text-stone-500">{t(lang, "ownerLiveOpsSub")}</p>
        </div>
        <Link to="/office/open-shifts" className="text-[11px] font-black text-waka-700">
          {t(lang, "ownerShiftViewAll")} →
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label={t(lang, "ownerLiveOpsOpenShifts")} value={String(live.openShiftCount)} />
        <Tile label={t(lang, "ownerLiveOpsCashiers")} value={String(live.activeCashierCount)} />
        <Tile label={t(lang, "ownerLiveOpsDevicesOnline")} value={String(live.devicesOnline)} />
        <Tile
          label={t(lang, "ownerLiveOpsDrawer")}
          value={live.dayDrawerOpen ? t(lang, "ownerCashDrawerOpenYes") : t(lang, "ownerCashDrawerOpenNo")}
        />
        <Tile label={t(lang, "cmdCenterKpiExpectedCash")} value={formatShortUgx(expectedCashUgx)} />
        <Tile label={t(lang, "ownerLiveOpsUnsynced")} value={String(live.unsyncedOperations)} warn={queueWarn} />
      </div>
    </section>
  );
}
