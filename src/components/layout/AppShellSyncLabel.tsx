import { memo } from "react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../../offline/cloudSync";

function label(lang: Language, syncing: boolean, pendingCount: number, online: boolean, syncErrors: number): string {
  if (!online) return `${t(lang, "workingOfflineLabel")} · ${t(lang, "savedOffline")}`;
  if (syncing) return t(lang, "syncingShort");
  if (syncErrors > 0) return tTemplate(lang, "syncErrorCount", { count: String(syncErrors) });
  if (pendingCount > 0) return `${t(lang, "willSyncLater")} (${pendingCount})`;
  return t(lang, "allSavedShort");
}

/** Isolated sync strip — updates here do not re-render the whole AppShell / POS tree. */
export const AppShellSyncLabel = memo(function AppShellSyncLabel({ lang }: { lang: Language }) {
  const { isOnline } = useOfflineStatus();
  const { syncing, pendingCount, health } = useSyncStatus();
  const syncErrors = countSalesWithSyncErrors();
  const hasIssue = isOnline && (syncErrors > 0 || health.lastIssueCode === "error" || health.lastIssueCode === "partial");

  return (
    <p
      className={`truncate text-[11px] font-medium ${hasIssue ? "text-rose-800" : "text-waka-800/90"}`}
      title={hasIssue ? t(lang, "syncErrorBanner") : undefined}
    >
      {label(lang, syncing, pendingCount, isOnline, syncErrors)}
    </p>
  );
});
