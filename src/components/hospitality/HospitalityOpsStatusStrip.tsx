import clsx from "clsx";
import { Printer, Wifi, WifiOff } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { usePosStore } from "../../store/usePosStore";
import { useShallow } from "zustand/react/shallow";
import { resolveHospitalityHardware } from "../../lib/hospitalityHardware";

type Props = {
  lang: Language;
  className?: string;
};

export function HospitalityOpsStatusStrip({ lang, className }: Props) {
  const { isOnline, health } = useSyncStatus();
  const hardwarePrefs = usePosStore(
    useShallow((s) => ({
      hospitalityHardware: s.preferences.hospitalityHardware,
      businessType: s.preferences.businessType,
    })),
  );
  const hw = resolveHospitalityHardware(hardwarePrefs);
  const pendingPrints = (hw.printQueue ?? []).filter((j) => j.status === "queued" || j.status === "sending").length;
  const failedPrints = (hw.printQueue ?? []).filter((j) => j.status === "failed").length;
  const printerCount = (hw.printers ?? []).length;

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", className)}>
      <span
        className={clsx(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide",
          isOnline ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950",
        )}
      >
        {isOnline ? <Wifi className="h-3 w-3" aria-hidden /> : <WifiOff className="h-3 w-3" aria-hidden />}
        {isOnline ? t(lang, "hospitalityOpsOnline") : t(lang, "hospitalityOpsOffline")}
        {!isOnline && health.offlineSinceAt ? (
          <span className="normal-case opacity-80">· {t(lang, "hospitalityOpsOfflineQueue")}</span>
        ) : null}
      </span>
      {printerCount > 0 ? (
        <span
          className={clsx(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide",
            failedPrints > 0
              ? "bg-rose-100 text-rose-900"
              : pendingPrints > 0
                ? "bg-sky-100 text-sky-900"
                : "bg-stone-100 text-stone-700",
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
    </div>
  );
}
