import clsx from "clsx";
import { CalendarDays, Wifi, WifiOff } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { useSyncStatus } from "../../../hooks/useSyncStatus";
import { dateKeyKampala } from "../../../lib/datesUg";

type Props = {
  lang: Language;
  className?: string;
};

export function ReceiveStatusStrip({ lang, className }: Props) {
  const { isOnline } = useSyncStatus();
  const businessDate = dateKeyKampala(new Date());

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", className)}>
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold",
          isOnline ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950",
        )}
      >
        {isOnline ? <Wifi className="h-3 w-3" aria-hidden /> : <WifiOff className="h-3 w-3" aria-hidden />}
        {isOnline ? t(lang, "desktopHomeStatusSynced") : t(lang, "offlineShort")}
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
        <CalendarDays className="h-3 w-3" aria-hidden />
        {t(lang, "receiveSummaryBusinessDate")}: {businessDate}
      </span>
    </div>
  );
}
