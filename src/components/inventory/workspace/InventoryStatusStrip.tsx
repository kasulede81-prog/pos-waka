import clsx from "clsx";
import { CalendarDays, Clock, Printer, Wifi, WifiOff } from "lucide-react";
import { useMemo } from "react";
import type { Language } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { useSyncStatus } from "../../../hooks/useSyncStatus";
import { usePosStore } from "../../../store/usePosStore";
import { dateKeyKampala } from "../../../lib/datesUg";
import { countSalesWithSyncErrors } from "../../../offline/cloudSync";
import { resolveHospitalityHardware } from "../../../lib/hospitalityHardware";
import { isHospitalityMode } from "../../../lib/hospitality";
import { useShallow } from "zustand/react/shallow";

type Props = {
  lang: Language;
  className?: string;
};

function formatRelativeTime(iso: string, lang: Language): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return t(lang, "iwStatusJustNow");
  if (mins < 60) return tTemplate(lang, "iwStatusMinutesAgo", { count: String(mins) });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tTemplate(lang, "iwStatusHoursAgo", { count: String(hours) });
  const days = Math.floor(hours / 24);
  return tTemplate(lang, "iwStatusDaysAgo", { count: String(days) });
}

export function InventoryStatusStrip({ lang, className }: Props) {
  const { isOnline, health, pendingCount } = useSyncStatus();
  const syncErrors = countSalesWithSyncErrors();
  const { products, preferences } = usePosStore(
    useShallow((s) => ({
      products: s.products,
      preferences: s.preferences,
    })),
  );

  const businessDate = dateKeyKampala(new Date());
  const openShiftCount = (preferences.shifts ?? []).filter((sh) => !sh.endAt).length;

  const inventoryLastUpdated = useMemo(() => {
    let latest = "";
    for (const p of products) {
      const at = p.updatedAt;
      if (at && at > latest) latest = at;
    }
    return latest;
  }, [products]);

  const hw = resolveHospitalityHardware({
    hospitalityHardware: preferences.hospitalityHardware,
    businessType: preferences.businessType,
  });
  const showPrinter = isHospitalityMode(preferences.businessType) && (hw.printers ?? []).length > 0;
  const failedPrints = (hw.printQueue ?? []).filter((j) => j.status === "failed").length;
  const pendingPrints = (hw.printQueue ?? []).filter((j) => j.status === "queued" || j.status === "sending").length;

  const chipClass =
    "inline-flex items-center gap-1.5 rounded-full border border-border/90 bg-card px-2.5 py-1 text-[10px] font-bold text-muted-foreground shadow-sm";

  return (
    <section className={clsx("space-y-2", className)} aria-label={t(lang, "iwStatusStripLabel")}>
      <h3 className="px-0.5 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
        {t(lang, "iwStatusStripLabel")}
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={clsx(
            chipClass,
            isOnline && syncErrors === 0 && pendingCount === 0
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-950",
          )}
        >
          {isOnline ? <Wifi className="h-3 w-3" aria-hidden /> : <WifiOff className="h-3 w-3" aria-hidden />}
          {isOnline
            ? pendingCount > 0 || syncErrors > 0
              ? t(lang, "desktopHomeStatusSyncPending")
              : t(lang, "desktopHomeStatusSynced")
            : t(lang, "offlineShort")}
        </span>

        {!isOnline && health.offlineSinceAt ? (
          <span className={chipClass}>
            <Clock className="h-3 w-3" aria-hidden />
            {formatRelativeTime(health.offlineSinceAt, lang)}
          </span>
        ) : null}

        {showPrinter ? (
          <span
            className={clsx(
              chipClass,
              failedPrints > 0
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : pendingPrints > 0
                  ? "border-sky-200 bg-sky-50 text-sky-900"
                  : undefined,
            )}
          >
            <Printer className="h-3 w-3" aria-hidden />
            {failedPrints > 0
              ? tTemplate(lang, "hospitalityOpsPrinterFailed", { count: failedPrints })
              : pendingPrints > 0
                ? tTemplate(lang, "hospitalityOpsPrinterQueue", { count: pendingPrints })
                : t(lang, "hospitalityOpsPrinterReady")}
          </span>
        ) : null}

        <span className={chipClass}>
          <CalendarDays className="h-3 w-3" aria-hidden />
          {t(lang, "iwStatusBusinessDate")}: {businessDate}
        </span>

        <span className={chipClass}>
          {t(lang, "iwStatusOpenShifts")}: {openShiftCount}
        </span>

        {inventoryLastUpdated ? (
          <span className={chipClass}>
            <Clock className="h-3 w-3" aria-hidden />
            {t(lang, "iwStatusInventoryUpdated")}: {formatRelativeTime(inventoryLastUpdated, lang)}
          </span>
        ) : null}
      </div>
    </section>
  );
}
