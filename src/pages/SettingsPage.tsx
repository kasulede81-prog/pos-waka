import type { User } from "@supabase/supabase-js";
import type { Language, BusinessType, UserRole } from "../types";
import { hasSupabaseConfig } from "../lib/supabase";
import { t } from "../lib/i18n";
import { BUSINESS_TYPE_IDS } from "../config/businessTypes";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { canUseDevRoleSimulator, hasPermission, resolveAuthRole } from "../lib/permissions";
import { BackupSettingsCard } from "../components/BackupSettingsCard";

type Props = {
  lang: Language;
  email: string | null | undefined;
  shopName?: string | null;
  onSignOut: () => Promise<void>;
  user: User | null;
  authMode: "supabase" | "local";
};

const ROLE_OPTIONS: UserRole[] = ["owner", "manager", "cashier", "stock_keeper"];

export function SettingsPage({ lang, email, shopName, onSignOut, user, authMode }: Props) {
  const actor = useSessionActor();
  const canBackup = hasPermission(actor.role, "settings.shop");
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const updateBusinessType = usePosStore((s) => s.updateBusinessType);

  const meta = user?.user_metadata as Record<string, unknown> | undefined;
  const authResolved = resolveAuthRole({ mode: authMode, userMetadata: meta });
  const showDevSimulator =
    (!hasSupabaseConfig || Boolean(import.meta.env.DEV)) && canUseDevRoleSimulator(authResolved);

  return (
    <div className="space-y-5 pb-8">
      <h2 className="text-3xl font-black text-slate-900">{t(lang, "settings")}</h2>

      <article className="rounded-3xl border-2 border-slate-100 bg-white p-5">
        <p className="font-black text-slate-900">{t(lang, "accountHeading")}</p>
        <p className="mt-2 text-slate-600">
          <span className="font-bold">{t(lang, "loggedInAs")}:</span> {email ?? "—"}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          <span className="font-bold">Role:</span> {actor.role}
        </p>
        {shopName ? (
          <p className="mt-1 text-slate-600">
            <span className="font-bold">{t(lang, "shopHeading")}:</span> {shopName}
          </p>
        ) : null}
        <p className="mt-3 text-sm text-slate-500">{t(lang, "sessionHelp")}</p>
        <button
          type="button"
          onClick={() => onSignOut()}
          className="mt-4 w-full rounded-2xl bg-red-600 py-4 text-lg font-black text-white"
        >
          {t(lang, "logoutFromSettings")}
        </button>
      </article>

      {hasPermission(actor.role, "settings.shop") ? (
        <article className="rounded-3xl border-2 border-emerald-100 bg-emerald-50/40 p-5">
          <p className="text-xl font-black text-emerald-950">{t(lang, "businessSettings")}</p>
          <p className="mt-1 text-sm text-emerald-900">{t(lang, "businessSettingsHelp")}</p>
          <label className="mt-4 block font-bold text-slate-900">{t(lang, "businessTypeLabel")}</label>
          <select
            value={preferences.businessType}
            onChange={(e) => updateBusinessType(e.target.value as BusinessType)}
            className="mt-2 w-full rounded-2xl border-2 border-emerald-200 bg-white px-4 py-4 text-lg font-semibold"
          >
            {BUSINESS_TYPE_IDS.map((id) => (
              <option key={id} value={id}>
                {t(lang, `businessType_${id}`)}
              </option>
            ))}
          </select>
          <label className="mt-6 flex items-center gap-3 text-lg font-bold text-slate-900">
            <input
              type="checkbox"
              checked={preferences.kioskQuickSell}
              onChange={(e) => setPreferences({ kioskQuickSell: e.target.checked })}
              className="h-6 w-6 rounded border-2 border-slate-400"
            />
            {t(lang, "kioskQuickSellLabel")}
          </label>
        </article>
      ) : null}

      {showDevSimulator ? (
        <article className="rounded-3xl border-2 border-amber-100 bg-amber-50/50 p-5">
          <p className="text-lg font-black text-amber-950">{t(lang, "roleSimulatorTitle")}</p>
          <p className="mt-1 text-sm text-amber-900">{t(lang, "roleSimulatorSub")}</p>
          <label className="mt-4 block font-bold text-slate-900">Simulated role</label>
          <select
            value={preferences.devRoleOverride ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setPreferences({ devRoleOverride: v === "" ? null : (v as UserRole) });
            }}
            className="mt-2 w-full rounded-2xl border-2 border-amber-200 bg-white px-4 py-3 text-lg font-semibold"
          >
            <option value="">— Sign-in role —</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </article>
      ) : null}

      {hasPermission(actor.role, "owner.cash_history") ? (
        <article className="rounded-3xl border-2 border-slate-100 bg-white p-5">
          <p className="text-xl font-black text-slate-900">{t(lang, "cashVarianceTitle")}</p>
          <p className="mt-1 text-sm text-slate-600">Used when flagging day-close differences (Back office & Close day).</p>
          <label className="mt-4 block font-bold text-slate-800">{t(lang, "cashVariancePct")}</label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={preferences.cashVarianceThresholdPct ?? 5}
            onChange={(e) => setPreferences({ cashVarianceThresholdPct: Number(e.target.value) || 0 })}
            className="mt-2 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
          />
          <label className="mt-4 block font-bold text-slate-800">{t(lang, "cashVarianceFixed")}</label>
          <input
            type="number"
            min={0}
            step={1000}
            value={preferences.cashVarianceThresholdUgxFixed ?? 10_000}
            onChange={(e) => setPreferences({ cashVarianceThresholdUgxFixed: Math.floor(Number(e.target.value) || 0) })}
            className="mt-2 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
          />
        </article>
      ) : null}

      <article className="rounded-3xl border-2 border-slate-100 bg-white p-5">
        <p className="text-xl font-black text-slate-900">{t(lang, "androidFeelTitle")}</p>
        <p className="mt-1 text-sm text-slate-600">{t(lang, "androidFeelSub")}</p>
        <label className="mt-5 flex min-h-[52px] cursor-pointer items-center gap-3 text-lg font-bold text-slate-900">
          <input
            type="checkbox"
            checked={preferences.hapticsOn !== false}
            onChange={(e) => setPreferences({ hapticsOn: e.target.checked })}
            className="h-6 w-6 rounded border-2 border-slate-400 accent-emerald-600"
          />
          {t(lang, "hapticsSetting")}
        </label>
        <label className="mt-4 flex min-h-[52px] cursor-pointer items-center gap-3 text-lg font-bold text-slate-900">
          <input
            type="checkbox"
            checked={preferences.saleSoundOn !== false}
            onChange={(e) => setPreferences({ saleSoundOn: e.target.checked })}
            className="h-6 w-6 rounded border-2 border-slate-400 accent-emerald-600"
          />
          {t(lang, "saleSoundSetting")}
        </label>
      </article>

      {canBackup ? <BackupSettingsCard lang={lang} /> : null}

      <article className="rounded-3xl border-2 border-slate-100 bg-white p-5">
        <p className="font-bold text-slate-900">Supabase</p>
        <p className="text-sm text-slate-600">{hasSupabaseConfig ? "Connected keys found." : t(lang, "supabaseMissing")}</p>
      </article>
    </div>
  );
}
