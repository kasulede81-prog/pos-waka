import { memo } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
import { useSyncStatus } from "../../hooks/useSyncStatus";

function label(lang: Language, syncing: boolean, pendingCount: number, online: boolean): string {
  if (!online) return `${t(lang, "workingOfflineLabel")} · ${t(lang, "savedOffline")}`;
  if (syncing) return t(lang, "syncingShort");
  if (pendingCount > 0) return `${t(lang, "willSyncLater")} (${pendingCount})`;
  return t(lang, "allSavedShort");
}

/** Isolated sync strip — updates here do not re-render the whole AppShell / POS tree. */
export const AppShellSyncLabel = memo(function AppShellSyncLabel({ lang }: { lang: Language }) {
  const { isOnline } = useOfflineStatus();
  const { syncing, pendingCount } = useSyncStatus();
  return (
    <p className="truncate text-[11px] font-medium text-waka-800/90">
      {label(lang, syncing, pendingCount, isOnline)}
    </p>
  );
});
