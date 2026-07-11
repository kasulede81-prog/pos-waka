import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { EnterprisePasswordField } from "../components/auth/EnterprisePasswordField";

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
      <p className="rounded-2xl border border-border bg-muted px-4 py-3 text-sm font-medium text-muted-foreground">
        {t(lang, "settingsPasswordHint")}
      </p>
      {ok ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
          {ok}
        </p>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-3xl border border-border bg-card p-5 shadow-sm">
        <EnterprisePasswordField
          lang={lang}
          label={t(lang, "newPassword")}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          showStrength
          loading={busy}
          error={error}
        />
        <EnterprisePasswordField
          lang={lang}
          label={t(lang, "confirmPassword")}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          loading={busy}
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-[52px] w-full rounded-2xl bg-waka-600 py-3.5 text-base font-black text-white disabled:opacity-50"
        >
          {busy ? "…" : t(lang, "settingsPasswordSave")}
        </button>
      </form>
    </div>
  );
}
