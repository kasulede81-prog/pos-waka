import type { Language } from "../types";
import { t } from "../lib/i18n";
import { SystemHealthDiagnosticsProvider, SystemHealthSummaryStrip } from "../components/settings/SystemHealthDiagnosticsProvider";
import { SyncHealthCard } from "../components/SyncHealthCard";
import { MultiDeviceHealthCard } from "../components/settings/MultiDeviceHealthCard";
import { UserCloudBackupStatusCard } from "../components/settings/UserCloudBackupStatusCard";
import { PageBackBar } from "../components/layout/PageBackBar";
import { usePageLoadMark } from "../hooks/usePageLoadMark";

export function SettingsSystemHealthPage({ lang }: { lang: Language }) {
  usePageLoadMark("settings-system-health");

  return (
    <SystemHealthDiagnosticsProvider>
      <div className="space-y-6 pb-8">
        <PageBackBar lang={lang} fallbackTo="/settings" label={t(lang, "settingsHubTitle")} />
        <div>
          <h1 className="text-2xl font-black text-foreground">{t(lang, "systemHealthPageTitle")}</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "systemHealthPageSub")}</p>
        </div>

        <SystemHealthSummaryStrip lang={lang} />

        <section className="rounded-2xl border border-border/90 bg-card p-4 shadow-sm">
          <p className="text-base font-black text-foreground">{t(lang, "multiDeviceHealthTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, "multiDeviceHealthUserSub")}</p>
          <div className="mt-3">
            <MultiDeviceHealthCard lang={lang} />
          </div>
        </section>

        <SyncHealthCard lang={lang} variant="simple" />

        <UserCloudBackupStatusCard lang={lang} />

        <p className="rounded-2xl border border-border bg-muted px-4 py-3 text-sm font-medium text-muted-foreground">
          {t(lang, "systemHealthSupportHint")}
        </p>
      </div>
    </SystemHealthDiagnosticsProvider>
  );
}
