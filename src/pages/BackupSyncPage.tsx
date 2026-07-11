import { actorHasPermission } from "../lib/actorAuthorization";
import { Link, Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { hasSupabaseConfig } from "../lib/supabase";
import { useSessionActor } from "../context/SessionActorContext";

import { useSubscription } from "../context/SubscriptionContext";
import { canUseBackupRestore } from "../lib/subscriptionEntitlements";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { SyncHealthCard } from "../components/SyncHealthCard";
import { BackupSettingsCard } from "../components/BackupSettingsCard";
import { AppUpdateCheckButton } from "../components/app-update/AppUpdateControls";
import { useToast } from "../context/ToastProvider";
import { DeviceApprovedGate } from "../components/device/DeviceApprovedGate";
import { useDeviceAuthority } from "../context/DeviceAuthorityContext";

export function BackupSyncPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { authMode, snapshot } = useSubscription();
  const canView = actorHasPermission(actor, "settings.view");
  const canBackupRole = actorHasPermission(actor, "settings.shop");
  const canBackupPlan = canUseBackupRestore(snapshot, authMode);
  const canBackup = canBackupRole && canBackupPlan;
  const { isDeviceAuthorized } = useDeviceAuthority();
  const toast = useToast();

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
        <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">{t(lang, "backupSyncOnlineTitle")}</h2>
        <SyncHealthCard lang={lang} variant="simple" />
      </section>

      {canBackup && isDeviceAuthorized ? (
        <section className="space-y-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">{t(lang, "backupSyncPhoneTitle")}</h2>
          <DeviceApprovedGate lang={lang}>
            <BackupSettingsCard lang={lang} compact actionsEnabled />
          </DeviceApprovedGate>
        </section>
      ) : canBackupRole && !isDeviceAuthorized ? (
        <DeviceApprovedGate lang={lang}>{null}</DeviceApprovedGate>
      ) : canBackupRole ? (
        <section className="rounded-2xl border border-waka-200 bg-waka-50 px-4 py-4">
          <p className="text-sm font-semibold text-waka-950">{t(lang, "backupUpgradeRequired")}</p>
          <p className="mt-2 text-xs font-medium text-waka-900">{t(lang, "planStarterName")}</p>
          <Link to="/upgrade" className="mt-3 inline-flex min-h-[44px] items-center rounded-2xl bg-waka-600 px-4 py-2 text-sm font-black text-white">
            {t(lang, "backupUpgradeCta")} →
          </Link>
        </section>
      ) : null}

      <section className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">{t(lang, "updateCheckForUpdates")}</h2>
        <p className="text-xs font-semibold text-muted-foreground">{t(lang, "appVersionLabel")}: {import.meta.env.VITE_APP_VERSION}</p>
        <AppUpdateCheckButton
          lang={lang}
          onResult={(message) => toast.success(message)}
        />
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">{t(lang, "backupSyncAccountTitle")}</h2>
        <p className="text-sm font-bold text-foreground">{onlineAccount}</p>
        <p className="text-xs font-semibold text-muted-foreground">{t(lang, "backupSyncAccountHint")}</p>
      </section>
    </div>
  );
}
