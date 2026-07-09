import { usePosStore } from "../store/usePosStore";
import { actorHasPermission } from "../lib/actorAuthorization";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { useSessionActor } from "../context/SessionActorContext";
import { Navigate } from "react-router-dom";
import { STAFF_AUTO_LOCK_OPTIONS, lockPos } from "../lib/auth";

export function SettingsStaffSecurityPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);

  if (!actorHasPermission(actor, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "settingsStaffSecurityTitle")}
        subtitle={t(lang, "settingsStaffSecuritySub")}
      />

      <section className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
        <label className="block text-sm font-bold text-stone-800 dark:text-stone-200">
          {t(lang, "settingsStaffAutoLock")}
          <select
            value={preferences.staffAutoLockMinutes ?? 0}
            onChange={(e) =>
              setPreferences({
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

        <ToggleRow
          label={t(lang, "settingsStaffRequirePinIdle")}
          checked={preferences.staffRequirePinAfterIdle !== false}
          onChange={(checked) => setPreferences({ staffRequirePinAfterIdle: checked })}
        />
        <ToggleRow
          label={t(lang, "settingsStaffAllowSwitchUser")}
          checked={preferences.staffAllowSwitchUser !== false}
          onChange={(checked) => setPreferences({ staffAllowSwitchUser: checked })}
        />
        <ToggleRow
          label={t(lang, "settingsStaffRememberSession")}
          checked={preferences.staffRememberSession !== false}
          onChange={(checked) => setPreferences({ staffRememberSession: checked })}
        />

        <label className="block text-sm font-bold text-stone-800 dark:text-stone-200">
          {t(lang, "settingsStaffMaxFailedAttempts")}
          <input
            type="number"
            min={3}
            max={10}
            value={preferences.staffMaxFailedAttempts ?? 5}
            onChange={(e) =>
              setPreferences({ staffMaxFailedAttempts: Math.min(10, Math.max(3, Number(e.target.value) || 5)) })
            }
            className="mt-1.5 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 dark:border-stone-700 dark:bg-stone-950"
          />
        </label>

        <label className="block text-sm font-bold text-stone-800 dark:text-stone-200">
          {t(lang, "settingsStaffSessionTimeout")}
          <select
            value={preferences.staffSessionTimeoutMinutes ?? 480}
            onChange={(e) => setPreferences({ staffSessionTimeoutMinutes: Number(e.target.value) })}
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
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 text-sm font-bold text-stone-800 dark:text-stone-200">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 rounded border-stone-300 text-waka-600"
      />
    </label>
  );
}

function tTemplateMinutes(lang: Language, minutes: number): string {
  return t(lang, minutes === 1 ? "settingsStaffAutoLockOneMin" : "settingsStaffAutoLockMinutes").replace(
    "{minutes}",
    String(minutes),
  );
}
