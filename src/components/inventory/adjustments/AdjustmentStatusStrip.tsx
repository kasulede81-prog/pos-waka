import clsx from "clsx";
import { CalendarDays, Clock, Wifi, WifiOff } from "lucide-react";
import { useMemo } from "react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { useSyncStatus } from "../../../hooks/useSyncStatus";
import { usePosStore } from "../../../store/usePosStore";
import { dateKeyKampala } from "../../../lib/datesUg";

type Props = {
  lang: Language;
  className?: string;
};

export function AdjustmentStatusStrip({ lang, className }: Props) {
  const { isOnline } = useSyncStatus();
  const products = usePosStore((s) => s.products);
  const shifts = usePosStore((s) => s.preferences.shifts);
  const businessDate = dateKeyKampala(new Date());
  const openShiftCount = (shifts ?? []).filter((sh) => !sh.endAt).length;

  const inventoryLastUpdated = useMemo(() => {
    let latest = "";
    for (const p of products) {
      const at = p.updatedAt;
      if (at && at > latest) latest = at;
    }
    return latest;
  }, [products]);

  const chipClass =
    "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-[10px] font-bold text-muted-foreground";

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", className)}>
      <span
        className={clsx(
          chipClass,
          isOnline ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950",
        )}
      >
        {isOnline ? <Wifi className="h-3 w-3" aria-hidden /> : <WifiOff className="h-3 w-3" aria-hidden />}
        {isOnline ? t(lang, "desktopHomeStatusSynced") : t(lang, "offlineShort")}
      </span>
      <span className={chipClass}>
        <CalendarDays className="h-3 w-3" aria-hidden />
        {t(lang, "receiveSummaryBusinessDate")}: {businessDate}
      </span>
      <span className={chipClass}>
        {t(lang, "iwStatusOpenShifts")}: {openShiftCount}
      </span>
      {inventoryLastUpdated ? (
        <span className={chipClass}>
          <Clock className="h-3 w-3" aria-hidden />
          {t(lang, "iwStatusInventoryUpdated")}: {new Date(inventoryLastUpdated).toLocaleDateString()}
        </span>
      ) : null}
    </div>
  );
}
