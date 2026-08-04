import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../../offline/cloudSync";
import { statusTokens } from "../../lib/statusTokens";
import { enterpriseSpace } from "../../lib/enterpriseSpacing";
import clsx from "clsx";

type Props = { lang: Language };

/** Plain-language reassurance for Home dashboards (offline, pending upload, upload issues). */
export function HomeTrustBanner({ lang }: Props) {
  const sync = useSyncStatus();
  const uploadIssues = countSalesWithSyncErrors();
  const hasWarning = (sync.isOnline && sync.pendingCount > 0) || uploadIssues > 0;
  const tone = !sync.isOnline ? statusTokens.info : hasWarning ? statusTokens.warning : statusTokens.success;

  return (
    <section className={clsx("space-y-2 shadow-elev", enterpriseSpace.kpiPad, tone.banner)}>
      <p className="text-sm font-bold">{t(lang, "syncTrustSavedOnPhone")}</p>
      {!sync.isOnline ? (
        <>
          <p className="text-sm font-semibold text-foreground">{t(lang, "homeTrustOfflineSell")}</p>
          <p className="text-xs font-medium text-muted-foreground">{t(lang, "syncTrustKeepUsing")}</p>
        </>
      ) : null}
      {sync.syncing ? (
        <p className="text-sm font-semibold text-foreground">{t(lang, "homeTrustUploading")}</p>
      ) : null}
      {sync.isOnline && sync.pendingCount > 0 ? (
        <p className="text-sm font-semibold text-foreground">
          {tTemplate(lang, "posUploadPendingCount", { count: String(sync.pendingCount) })}
        </p>
      ) : null}
      {sync.isOnline && uploadIssues > 0 ? (
        <p className="text-sm font-semibold text-foreground">
          {tTemplate(lang, "homeTrustSalesNeedUpload", { count: String(uploadIssues) })}
        </p>
      ) : null}
      {sync.isOnline && sync.pendingCount === 0 && uploadIssues === 0 && !sync.syncing ? (
        <p className="text-xs font-semibold opacity-90">{t(lang, "homeTrustAllUploaded")}</p>
      ) : null}
    </section>
  );
}
