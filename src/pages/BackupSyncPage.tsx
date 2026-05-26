import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { hasSupabaseConfig } from "../lib/supabase";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { useSubscription } from "../context/SubscriptionContext";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { SyncHealthCard } from "../components/SyncHealthCard";
import { BackupSettingsCard } from "../components/BackupSettingsCard";

export function BackupSyncPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { authMode } = useSubscription();
  const canView = hasPermission(actor.role, "settings.view");
  const canBackup = hasPermission(actor.role, "settings.shop");

  if (!canView) {
    return <Navigate to="/office" replace />;
  }

  const onlineAccount =
    authMode === "supabase" && hasSupabaseConfig
      ? t(lang, "backupSyncAccountConnected")
      : t(lang, "backupSyncAccountOffline");

  return (
    <div className="space-y-6 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "officeCardBackup")}
        subtitle={t(lang, "backupSyncPageSub")}
        backTo="/office"
        backLabel={t(lang, "officeBackToHub")}
      />

      <section className="space-y-3">
        <h2 className="text-xs font-black uppercase tracking-wider text-stone-500">{t(lang, "backupSyncOnlineTitle")}</h2>
        <SyncHealthCard lang={lang} variant="simple" />
      </section>

      {canBackup ? (
        <section className="space-y-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-stone-500">{t(lang, "backupSyncPhoneTitle")}</h2>
          <BackupSettingsCard lang={lang} compact />
        </section>
      ) : null}

      <section className="space-y-2 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-xs font-black uppercase tracking-wider text-stone-500">{t(lang, "backupSyncAccountTitle")}</h2>
        <p className="text-sm font-bold text-stone-800">{onlineAccount}</p>
        <p className="text-xs font-semibold text-stone-500">{t(lang, "backupSyncAccountHint")}</p>
      </section>
    </div>
  );
}
