import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, CloudOff, Printer, RefreshCw, Wifi } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { usePosStore } from "../../../store/usePosStore";
import type { TerminalIdentityView } from "../../../lib/terminalIdentity";
import { TerminalIdentityStrip } from "../TerminalIdentityStrip";
import { useSyncStatus } from "../../../hooks/useSyncStatus";
import { useOfflineStatus } from "../../../hooks/useOfflineStatus";
import { countSalesWithSyncErrors } from "../../../offline/cloudSync";
import { hasCapability } from "../../../platform";

type Props = {
  lang: Language;
  identity: TerminalIdentityView;
  terminalLabel?: string | null;
  className?: string;
};

/** Desktop POS status bar — shop, operator/seller, connectivity, sync, time. */
export function DesktopStatusBar({ lang, identity, terminalLabel, className }: Props) {
  const preferences = usePosStore((s) => s.preferences);
  const sync = useSyncStatus();
  const { isOnline } = useOfflineStatus();
  const syncErrors = countSalesWithSyncErrors();
  const synced = sync.pendingCount === 0 && syncErrors === 0 && !sync.syncing;
  const [nowLabel, setNowLabel] = useState("");

  const shopName = preferences.shopDisplayName?.trim() || t(lang, "posDesktopDefaultShop");
  const printerReady = hasCapability("escPosNetwork");

  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      setNowLabel(
        d.toLocaleString(undefined, {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    };
    fmt();
    const id = window.setInterval(fmt, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const syncLabel = useMemo(() => {
    if (sync.syncing) return t(lang, "posDesktopStatusSyncing");
    if (synced) return t(lang, "desktopHomeStatusSynced");
    return t(lang, "desktopHomeStatusSyncPending");
  }, [lang, sync.syncing, synced]);

  return (
    <footer
      className={clsx(
        "desktop-pos-status-bar flex h-8 shrink-0 items-center gap-3 border-t border-border/90 bg-muted/95 px-3 text-[11px] font-semibold text-muted-foreground",
        className,
      )}
      role="contentinfo"
    >
      <span className="truncate font-black text-foreground">WAKA</span>
      <span className="hidden truncate sm:inline" title={shopName}>
        {shopName}
      </span>
      <TerminalIdentityStrip lang={lang} identity={identity} terminalLabel={terminalLabel} compact />

      <span
        className={clsx(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black",
          isOnline ? "border-success/30 bg-success-muted text-success" : "border-border bg-muted text-muted-foreground",
        )}
        role="status"
      >
        {isOnline ? <Wifi className="h-3 w-3" aria-hidden /> : <CloudOff className="h-3 w-3" aria-hidden />}
        {isOnline ? t(lang, "posDesktopStatusOnline") : t(lang, "posDesktopStatusOffline")}
      </span>

      <span
        className={clsx(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black",
          synced ? "border-success/30 bg-success-muted text-success" : "border-warning/30 bg-warning-muted text-warning-foreground",
        )}
      >
        {sync.syncing ? <RefreshCw className="h-3 w-3 animate-spin" aria-hidden /> : synced ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : null}
        {syncLabel}
      </span>

      {printerReady ? (
        <span className="hidden items-center gap-1 md:inline-flex">
          <Printer className="h-3 w-3" aria-hidden />
          {t(lang, "posDesktopStatusDesktop")}
        </span>
      ) : null}

      <span className="ml-auto shrink-0 tabular-nums">{nowLabel}</span>
    </footer>
  );
}
