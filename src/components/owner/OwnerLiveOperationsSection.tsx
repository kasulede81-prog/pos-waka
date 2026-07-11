import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerLiveOperationsSnapshot } from "../../lib/ownerCommandCenterBuilders";

type Props = {
  lang: Language;
  live: OwnerLiveOperationsSnapshot;
};

function formatSyncAt(iso: string | null, lang: Language): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(lang === "lg" ? "lg-UG" : "en-UG", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl px-2.5 py-2 ${warn ? "bg-amber-50" : "bg-muted"}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-black tabular-nums ${warn ? "text-amber-900" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

export function OwnerLiveOperationsSection({ lang, live }: Props) {
  const queueWarn =
    live.queueHealth === "degraded" || live.queueHealth === "backing_off" || live.unsyncedOperations > 0;

  return (
    <section className="rounded-2xl border border-border/90 bg-card p-3 shadow-sm sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-foreground sm:text-base">{t(lang, "ownerLiveOpsTitle")}</h2>
          <p className="text-[11px] font-semibold text-muted-foreground">{t(lang, "ownerLiveOpsSub")}</p>
        </div>
        <Link
          to="/settings/devices"
          className="shrink-0 text-[11px] font-black text-waka-700"
        >
          {t(lang, "ownerLiveOpsDevicesLink")} →
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label={t(lang, "ownerLiveOpsOpenShifts")} value={String(live.openShiftCount)} />
        <Metric label={t(lang, "ownerLiveOpsCashiers")} value={String(live.activeCashierCount)} />
        <Metric
          label={t(lang, "ownerLiveOpsDrawer")}
          value={live.dayDrawerOpen ? t(lang, "ownerCashDrawerOpenYes") : t(lang, "ownerCashDrawerOpenNo")}
        />
        <Metric
          label={t(lang, "ownerLiveOpsFloat")}
          value={live.openingFloatUgx != null ? `UGX ${live.openingFloatUgx.toLocaleString()}` : "—"}
        />
        <Metric label={t(lang, "ownerLiveOpsDevicesOnline")} value={String(live.devicesOnline)} />
        <Metric
          label={t(lang, "ownerLiveOpsDevicesStale")}
          value={String(live.devicesStale)}
          warn={live.devicesStale > 0}
        />
        <Metric label={t(lang, "ownerLiveOpsLastSync")} value={formatSyncAt(live.lastSyncAt, lang)} />
        <Metric
          label={t(lang, "ownerLiveOpsUnsynced")}
          value={String(live.unsyncedOperations)}
          warn={queueWarn}
        />
      </div>
      {live.activeCashierLabels.length > 0 ? (
        <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
          {t(lang, "ownerLiveOpsActiveList")}: {live.activeCashierLabels.join(", ")}
        </p>
      ) : null}
    </section>
  );
}
