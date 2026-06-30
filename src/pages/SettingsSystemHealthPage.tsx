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
          <h1 className="text-2xl font-black text-stone-950">{t(lang, "systemHealthPageTitle")}</h1>
          <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "systemHealthPageSub")}</p>
        </div>

        <SystemHealthSummaryStrip lang={lang} />

        <section className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
          <p className="text-base font-black text-stone-900">{t(lang, "multiDeviceHealthTitle")}</p>
          <p className="mt-1 text-sm text-stone-600">{t(lang, "multiDeviceHealthUserSub")}</p>
          <div className="mt-3">
            <MultiDeviceHealthCard lang={lang} />
          </div>
        </section>

        <SyncHealthCard lang={lang} variant="simple" />

        <UserCloudBackupStatusCard lang={lang} />

        <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-medium text-stone-600">
          {t(lang, "systemHealthSupportHint")}
        </p>
      </div>
    </SystemHealthDiagnosticsProvider>
  );
}
