import { useMemo } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";

type Props = { lang: Language };

/** Thin status bar at the bottom of enterprise desktop POS. */
export function PosDesktopStatusBar({ lang }: Props) {
  const preferences = usePosStore((s) => s.preferences);
  const sync = useSyncStatus();
  const { isOnline } = useOfflineStatus();

  const nowLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  const shopName = preferences.shopDisplayName?.trim() || t(lang, "posDesktopDefaultShop");

  return (
    <footer
      className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border/90 bg-muted/90 px-3 text-[10px] font-semibold text-muted-foreground"
      role="contentinfo"
    >
      <span className="truncate">Waka POS · {t(lang, "posDesktopStatusDesktop")}</span>
      <span className="hidden truncate sm:inline">
        {isOnline ? t(lang, "posDesktopStatusOnline") : t(lang, "posDesktopStatusOffline")}
        {sync.syncing ? ` · ${t(lang, "posDesktopStatusSyncing")}` : ""}
      </span>
      <span className="truncate">{shopName}</span>
      <span className="shrink-0 tabular-nums">{nowLabel}</span>
    </footer>
  );
}
