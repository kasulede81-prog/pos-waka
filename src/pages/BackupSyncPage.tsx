import { Link, Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { hasSupabaseConfig } from "../lib/supabase";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { useSubscription } from "../context/SubscriptionContext";
import { canUseBackupRestore } from "../lib/subscriptionEntitlements";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { SyncHealthCard } from "../components/SyncHealthCard";
import { BackupSettingsCard } from "../components/BackupSettingsCard";
import { PrimaryDeviceGate } from "../components/device/ManagedByPrimaryDevice";
import { useDeviceAuthority } from "../context/DeviceAuthorityContext";

export function BackupSyncPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { authMode, snapshot } = useSubscription();
  const canView = hasPermission(actor.role, "settings.view");
  const canBackupRole = hasPermission(actor.role, "settings.shop");
  const canBackupPlan = canUseBackupRestore(snapshot, authMode);
  const canBackup = canBackupRole && canBackupPlan;
  const { isPrimary } = useDeviceAuthority();

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

      {canBackup && isPrimary ? (
        <section className="space-y-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-stone-500">{t(lang, "backupSyncPhoneTitle")}</h2>
          <PrimaryDeviceGate lang={lang}>
            <BackupSettingsCard lang={lang} compact actionsEnabled />
          </PrimaryDeviceGate>
        </section>
      ) : canBackupRole && !isPrimary ? (
        <PrimaryDeviceGate lang={lang}>{null}</PrimaryDeviceGate>
      ) : canBackupRole ? (
        <section className="rounded-2xl border border-waka-200 bg-waka-50 px-4 py-4">
          <p className="text-sm font-semibold text-waka-950">{t(lang, "backupUpgradeRequired")}</p>
          <p className="mt-2 text-xs font-medium text-waka-900">{t(lang, "planStarterName")}</p>
          <Link to="/upgrade" className="mt-3 inline-flex min-h-[44px] items-center rounded-2xl bg-waka-600 px-4 py-2 text-sm font-black text-white">
            {t(lang, "backupUpgradeCta")} →
          </Link>
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
