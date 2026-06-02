import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../../offline/cloudSync";

type Props = { lang: Language };

/** Plain-language reassurance for Home dashboards (offline, pending upload, upload issues). */
export function HomeTrustBanner({ lang }: Props) {
  const sync = useSyncStatus();
  const uploadIssues = countSalesWithSyncErrors();

  return (
    <section className="space-y-2 rounded-3xl border border-emerald-200/90 bg-emerald-50/90 p-3.5 shadow-sm">
      <p className="text-sm font-bold text-emerald-950">{t(lang, "syncTrustSavedOnPhone")}</p>
      {!sync.isOnline ? (
        <>
          <p className="text-sm font-semibold text-stone-800">{t(lang, "homeTrustOfflineSell")}</p>
          <p className="text-xs font-medium text-stone-600">{t(lang, "syncTrustKeepUsing")}</p>
        </>
      ) : null}
      {sync.syncing ? (
        <p className="text-sm font-semibold text-waka-900">{t(lang, "homeTrustUploading")}</p>
      ) : null}
      {sync.isOnline && sync.pendingCount > 0 ? (
        <p className="text-sm font-semibold text-amber-950">
          {tTemplate(lang, "autoSyncPendingBanner", { count: String(sync.pendingCount) })}
        </p>
      ) : null}
      {sync.isOnline && uploadIssues > 0 ? (
        <p className="text-sm font-semibold text-amber-950">
          {tTemplate(lang, "homeTrustSalesNeedUpload", { count: String(uploadIssues) })}
        </p>
      ) : null}
      {sync.isOnline && sync.pendingCount === 0 && uploadIssues === 0 && !sync.syncing ? (
        <p className="text-xs font-semibold text-emerald-900">{t(lang, "homeTrustAllUploaded")}</p>
      ) : null}
    </section>
  );
}
