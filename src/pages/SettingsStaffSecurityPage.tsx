import { usePosStore } from "../store/usePosStore";
import { actorHasPermission } from "../lib/actorAuthorization";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { Navigate } from "react-router-dom";
import { STAFF_AUTO_LOCK_OPTIONS, lockPos } from "../lib/auth";
import { SettingsAutoSaveShell } from "../components/enterprise/SettingsAutoSaveShell";
import { usePreferencesPatch } from "../components/enterprise/preferencesAutoSaveContext";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";

function StaffSecurityBody({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const savePreferences = usePreferencesPatch();

  return (
    <section className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <label className="block text-sm font-bold text-stone-800 dark:text-stone-200">
        {t(lang, "settingsStaffAutoLock")}
        <select
          value={preferences.staffAutoLockMinutes ?? 0}
          onChange={(e) =>
            savePreferences({
              staffAutoLockMinutes: Number(e.target.value) as (typeof STAFF_AUTO_LOCK_OPTIONS)[number],
            })
          }
          className="mt-1.5 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 dark:border-stone-700 dark:bg-stone-950"
        >
          <option value={0}>{t(lang, "settingsStaffAutoLockNever")}</option>
          {STAFF_AUTO_LOCK_OPTIONS.filter((m) => m > 0).map((m) => (
            <option key={m} value={m}>
              {tTemplateMinutes(lang, m)}
            </option>
          ))}
        </select>
      </label>

      <WakaSwitch
        checked={preferences.staffRequirePinAfterIdle !== false}
        onCheckedChange={(checked) => savePreferences({ staffRequirePinAfterIdle: checked })}
        label={t(lang, "settingsStaffRequirePinIdle")}
      />
      <WakaSwitch
        checked={preferences.staffAllowSwitchUser !== false}
        onCheckedChange={(checked) => savePreferences({ staffAllowSwitchUser: checked })}
        label={t(lang, "settingsStaffAllowSwitchUser")}
      />
      <WakaSwitch
        checked={preferences.staffRememberSession !== false}
        onCheckedChange={(checked) => savePreferences({ staffRememberSession: checked })}
        label={t(lang, "settingsStaffRememberSession")}
      />

      <label className="block text-sm font-bold text-stone-800 dark:text-stone-200">
        {t(lang, "settingsStaffMaxFailedAttempts")}
        <input
          type="number"
          min={3}
          max={10}
          value={preferences.staffMaxFailedAttempts ?? 5}
          onChange={(e) =>
            savePreferences({ staffMaxFailedAttempts: Math.min(10, Math.max(3, Number(e.target.value) || 5)) })
          }
          className="mt-1.5 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 dark:border-stone-700 dark:bg-stone-950"
        />
      </label>

      <label className="block text-sm font-bold text-stone-800 dark:text-stone-200">
        {t(lang, "settingsStaffSessionTimeout")}
        <select
          value={preferences.staffSessionTimeoutMinutes ?? 480}
          onChange={(e) => savePreferences({ staffSessionTimeoutMinutes: Number(e.target.value) })}
          className="mt-1.5 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 dark:border-stone-700 dark:bg-stone-950"
        >
          <option value={60}>1 {t(lang, "settingsStaffHour")}</option>
          <option value={240}>4 {t(lang, "settingsStaffHours")}</option>
          <option value={480}>8 {t(lang, "settingsStaffHours")}</option>
          <option value={720}>12 {t(lang, "settingsStaffHours")}</option>
          <option value={1440}>24 {t(lang, "settingsStaffHours")}</option>
        </select>
      </label>

      <button
        type="button"
        onClick={() => lockPos("manual")}
        className="min-h-[48px] w-full rounded-2xl bg-stone-900 py-3 text-base font-black text-white dark:bg-stone-100 dark:text-stone-900"
      >
        {t(lang, "settingsStaffLockNow")}
      </button>
    </section>
  );
}

export function SettingsStaffSecurityPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  if (!actorHasPermission(actor, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }
  return (
    <SettingsAutoSaveShell
      lang={lang}
      title={t(lang, "settingsStaffSecurityTitle")}
      subtitle={t(lang, "settingsStaffSecuritySub")}
    >
      <StaffSecurityBody lang={lang} />
    </SettingsAutoSaveShell>
  );
}

function tTemplateMinutes(lang: Language, minutes: number): string {
  return t(lang, minutes === 1 ? "settingsStaffAutoLockOneMin" : "settingsStaffAutoLockMinutes").replace(
    "{minutes}",
    String(minutes),
  );
}
