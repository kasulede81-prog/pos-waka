import { useI18n } from "@/lib/i18n";
import { useSyncStatus } from "@/lib/sync-status";

export function WakaLogo({
  size = "md",
  tagline = "SELL SMART. MANAGE BETTER.",
  status,
  showSync = true,
}: {
  size?: "sm" | "md" | "lg";
  tagline?: string | false;
  status?: string;
  showSync?: boolean;
}) {
  const { t } = useI18n();
  const sync = useSyncStatus();

  const dims = size === "sm" ? "h-10 w-10" : size === "lg" ? "h-14 w-14" : "h-12 w-12";
  const text = size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";

  let syncLabel: string | null = status ?? null;
  let syncTone = "text-waka-700";
  if (!status && showSync) {
    if (sync.state === "syncing") {
      syncLabel = t("sync.syncing");
      syncTone = "text-amber-600";
    } else if (sync.state === "queued") {
      syncLabel = t(sync.pending === 1 ? "sync.queued" : "sync.queued_plural", {
        n: sync.pending || 1,
      });
      syncTone = "text-amber-600";
    } else if (sync.state === "offline") {
      syncLabel = t("sync.offline");
      syncTone = "text-muted-foreground";
    } else if (sync.state === "error") {
      syncLabel = t("sync.error");
      syncTone = "text-rose-600";
    } else {
      syncLabel = t("sync.saved");
      syncTone = "text-waka-700";
    }
  }

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`${dims} relative grid place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20`}
      >
        <span className="text-xl font-black tracking-tight">W</span>
        <span className="absolute right-1 bottom-1 h-1.5 w-1.5 rounded-full bg-primary-foreground/80" />
      </div>
      <div className="flex flex-col leading-tight">
        <span className={`${text} font-black tracking-tight text-foreground`}>Waka POS</span>
        {tagline && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {tagline}
          </span>
        )}
        {syncLabel && (
          <span className={`flex items-center gap-1.5 text-[11px] font-bold ${syncTone}`}>
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                sync.state === "syncing" || sync.state === "queued"
                  ? "bg-amber-500 animate-pulse"
                  : sync.state === "offline"
                    ? "bg-muted-foreground/60"
                    : sync.state === "error"
                      ? "bg-rose-500"
                      : "bg-waka-600"
              }`}
            />
            {syncLabel}
          </span>
        )}
      </div>
    </div>
  );
}
