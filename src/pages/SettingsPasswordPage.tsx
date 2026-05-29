import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";

type Props = {
  lang: Language;
  authMode: "supabase" | "local";
  updatePassword: (password: string) => Promise<void>;
};

export function SettingsPasswordPage({ lang, authMode, updatePassword }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (authMode !== "supabase") {
    return <Navigate to="/settings" replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (password.length < 8) {
      setError(t(lang, "passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t(lang, "passwordMismatch"));
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setPassword("");
      setConfirm("");
      setOk(t(lang, "passwordUpdated"));
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.toLowerCase().includes("reauth") || msg.toLowerCase().includes("session")) {
        setError(t(lang, "settingsPasswordReauthHint"));
      } else {
        setError(msg || t(lang, "settingsPasswordFail"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "settingsHubPassword")}
        subtitle={t(lang, "settingsHubPasswordSub")}
      />
      <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-medium text-stone-700">
        {t(lang, "settingsPasswordHint")}
      </p>
      {ok ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
          {ok}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
          {error}
        </p>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-bold text-stone-800">
          {t(lang, "newPassword")}
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
          />
        </label>
        <label className="block text-sm font-bold text-stone-800">
          {t(lang, "confirmPassword")}
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="min-h-[48px] w-full rounded-2xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-50"
        >
          {busy ? t(lang, "saving") : t(lang, "settingsPasswordSave")}
        </button>
      </form>
    </div>
  );
}
