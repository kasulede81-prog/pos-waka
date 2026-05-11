import { useState } from "react";
import { Link } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import type { Language, UserRole } from "../types";
import { hasSupabaseConfig } from "../lib/supabase";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { canUseDevRoleSimulator, hasPermission, resolveAuthRole } from "../lib/permissions";
import { BackupSettingsCard } from "../components/BackupSettingsCard";
import { SyncHealthCard } from "../components/SyncHealthCard";
import { saveBusinessProfileToCloud } from "../lib/businessProfile";

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
  const [boPinNew, setBoPinNew] = useState("");
  const [boPinConfirm, setBoPinConfirm] = useState("");
  const [boPinFeedback, setBoPinFeedback] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [shopNameInput, setShopNameInput] = useState(preferences.shopDisplayName ?? shopName ?? "");
  const [shopPhoneInput, setShopPhoneInput] = useState(preferences.shopPhoneE164 ?? "");
  const [shopAddressInput, setShopAddressInput] = useState(preferences.shopAddressLine ?? "");
  const [shopCurrencyInput, setShopCurrencyInput] = useState(preferences.shopCurrency ?? "UGX");

  const meta = user?.user_metadata as Record<string, unknown> | undefined;
  const authResolved = resolveAuthRole({ mode: authMode, userMetadata: meta });
  const showDevSimulator =
    (!hasSupabaseConfig || Boolean(import.meta.env.DEV)) && canUseDevRoleSimulator(authResolved);

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-3xl font-black text-stone-900">{t(lang, "settings")}</h2>
        <p className="text-sm font-semibold text-stone-500">
          {t(lang, "appVersionLabel")}:{" "}
          <span className="font-mono text-stone-800">{import.meta.env.VITE_APP_VERSION ?? "—"}</span>
        </p>
      </div>

      <SyncHealthCard lang={lang} />

      {authMode === "supabase" ? (
        <Link
          to="/upgrade"
          className="block rounded-3xl border-2 border-waka-200 bg-gradient-to-r from-waka-50 to-white p-5 shadow-sm active:scale-[0.99]"
        >
          <p className="text-lg font-black text-waka-950">{t(lang, "settingsUpgradeTeaserTitle")}</p>
          <p className="mt-1 text-sm font-medium text-stone-700">{t(lang, "settingsUpgradeTeaserSub")}</p>
          <p className="mt-3 text-sm font-bold text-waka-800 underline">{t(lang, "upgradeNav")} →</p>
        </Link>
      ) : null}

      <article className="rounded-3xl border-2 border-stone-100 bg-white p-5 shadow-waka-sm">
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
        <article className="rounded-3xl border-2 border-waka-100 bg-waka-50/50 p-5 shadow-waka-sm">
          <p className="text-xl font-black text-waka-950">{t(lang, "businessSettings")}</p>
          <p className="mt-1 text-sm text-waka-900">{t(lang, "businessSettingsHelp")}</p>
          <div className="mt-4 rounded-2xl border-2 border-waka-200 bg-white p-4">
            <p className="text-sm font-black uppercase tracking-wide text-waka-900">{t(lang, "businessProfileTitle")}</p>
            <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "businessName")}</label>
            <input
              value={shopNameInput}
              onChange={(e) => setShopNameInput(e.target.value)}
              className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
            />
            <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "personPhonePh")}</label>
            <input
              value={shopPhoneInput}
              onChange={(e) => setShopPhoneInput(e.target.value)}
              className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
            />
            <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "shopAddress")}</label>
            <input
              value={shopAddressInput}
              onChange={(e) => setShopAddressInput(e.target.value)}
              className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
            />
            <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "businessCurrency")}</label>
            <input
              value={shopCurrencyInput}
              onChange={(e) => setShopCurrencyInput(e.target.value.toUpperCase())}
              className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
            />
            <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "businessTypeLabel")}</label>
            <div className="mt-1 rounded-2xl border-2 border-slate-200 bg-stone-50 px-4 py-3 text-base font-semibold text-stone-700">
              {t(lang, `businessType_${preferences.businessType}`)}
            </div>
            <p className="mt-2 text-xs font-bold text-stone-500">{t(lang, "businessTypeLockedMessage")}</p>
            {profileFeedback ? <p className="mt-2 text-sm font-bold text-waka-900">{profileFeedback}</p> : null}
            <button
              type="button"
              disabled={profileBusy}
              onClick={async () => {
                setProfileFeedback(null);
                if (!shopNameInput.trim()) {
                  setProfileFeedback(t(lang, "shopNameRequired"));
                  return;
                }
                setProfileBusy(true);
                try {
                  setPreferences({
                    shopDisplayName: shopNameInput.trim(),
                    shopPhoneE164: shopPhoneInput.trim() || null,
                    shopAddressLine: shopAddressInput.trim() || null,
                    shopCurrency: shopCurrencyInput.trim().toUpperCase() || "UGX",
                  });
                  await saveBusinessProfileToCloud(
                    {
                      shopName: shopNameInput.trim(),
                      businessType: preferences.businessType,
                      currency: shopCurrencyInput,
                      phone: shopPhoneInput,
                      address: shopAddressInput,
                    },
                    false,
                  );
                  setProfileFeedback(t(lang, "businessProfileSaved"));
                } catch {
                  setProfileFeedback(t(lang, "businessProfileSaveFailed"));
                } finally {
                  setProfileBusy(false);
                }
              }}
              className="mt-4 min-h-[48px] w-full rounded-2xl bg-waka-600 py-3 text-base font-black text-white"
            >
              {profileBusy ? "…" : t(lang, "saveBusinessProfile")}
            </button>
          </div>
          <label className="mt-6 flex items-center gap-3 text-lg font-bold text-slate-900">
            <input
              type="checkbox"
              checked={preferences.kioskQuickSell}
              onChange={(e) => setPreferences({ kioskQuickSell: e.target.checked })}
              className="h-6 w-6 rounded border-2 border-slate-400"
            />
            {t(lang, "kioskQuickSellLabel")}
          </label>

          <div className="mt-8 rounded-2xl border-2 border-waka-200/80 bg-white/80 p-4">
            <p className="text-lg font-black text-waka-950">{t(lang, "settingsBackOfficePinTitle")}</p>
            <p className="mt-1 text-sm text-waka-900/90">{t(lang, "settingsBackOfficePinSub")}</p>
            {preferences.backOfficePin ? (
              <p className="mt-3 text-sm font-semibold text-emerald-800">{t(lang, "settingsBackOfficePinActiveShort")}</p>
            ) : (
              <p className="mt-3 text-sm font-semibold text-stone-600">{t(lang, "settingsBackOfficePinNone")}</p>
            )}
            {boPinFeedback ? <p className="mt-2 text-sm font-bold text-waka-900">{boPinFeedback}</p> : null}
            <label className="mt-4 block text-sm font-bold text-slate-800">{t(lang, "settingsBackOfficePinNew")}</label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={boPinNew}
              onChange={(e) => {
                setBoPinFeedback(null);
                setBoPinNew(e.target.value.replace(/\D/g, "").slice(0, 6));
              }}
              className="mt-2 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-center text-xl font-black tracking-[0.25em]"
            />
            <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "settingsBackOfficePinConfirm")}</label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={boPinConfirm}
              onChange={(e) => {
                setBoPinFeedback(null);
                setBoPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6));
              }}
              className="mt-2 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-center text-xl font-black tracking-[0.25em]"
            />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="min-h-[48px] flex-1 rounded-2xl bg-waka-600 py-3 text-base font-black text-white shadow-waka-sm"
                onClick={() => {
                  setBoPinFeedback(null);
                  const a = boPinNew.replace(/\D/g, "");
                  const b = boPinConfirm.replace(/\D/g, "");
                  if (a.length < 4 || a.length > 6) {
                    setBoPinFeedback(t(lang, "settingsBackOfficePinLength"));
                    return;
                  }
                  if (a !== b) {
                    setBoPinFeedback(t(lang, "settingsBackOfficePinMismatch"));
                    return;
                  }
                  setPreferences({ backOfficePin: a });
                  setBoPinNew("");
                  setBoPinConfirm("");
                  setBoPinFeedback(t(lang, "settingsBackOfficePinSaved"));
                }}
              >
                {t(lang, "settingsBackOfficePinSave")}
              </button>
              <button
                type="button"
                className="min-h-[48px] flex-1 rounded-2xl border-2 border-slate-200 py-3 text-base font-bold text-slate-800"
                onClick={() => {
                  setBoPinNew("");
                  setBoPinConfirm("");
                  setPreferences({ backOfficePin: null });
                  setBoPinFeedback(t(lang, "settingsBackOfficePinCleared"));
                }}
              >
                {t(lang, "settingsBackOfficePinClear")}
              </button>
            </div>
          </div>
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
            className="h-6 w-6 rounded border-2 border-slate-400 accent-waka-600"
          />
          {t(lang, "hapticsSetting")}
        </label>
        <label className="mt-4 flex min-h-[52px] cursor-pointer items-center gap-3 text-lg font-bold text-slate-900">
          <input
            type="checkbox"
            checked={preferences.saleSoundOn !== false}
            onChange={(e) => setPreferences({ saleSoundOn: e.target.checked })}
            className="h-6 w-6 rounded border-2 border-slate-400 accent-waka-600"
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
