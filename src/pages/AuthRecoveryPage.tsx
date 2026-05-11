import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { t } from "../lib/i18n";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  mode: "supabase" | "local";
  updatePassword: (password: string) => Promise<void>;
};

export function AuthRecoveryPage({ lang, setLang, mode, updatePassword }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t(lang, "passwordMismatch"));
      return;
    }
    if (password.length < 8) {
      setError(t(lang, "passwordTooShort"));
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (mode !== "supabase") {
    return <Navigate to="/login" replace />;
  }

  if (done) {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <p className="font-medium">{t(lang, "passwordUpdated")}</p>
          <Link to="/login" className="mt-4 inline-block text-sm font-medium text-waka-700 underline">
            {t(lang, "backToLogin")}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{t(lang, "chooseNewPassword")}</h1>
        <p className="mt-3 text-xs text-slate-500">{t(lang, "forgotSubtitle")}</p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block text-sm">
            {t(lang, "newPassword")}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            {t(lang, "confirmPassword")}
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
          >
            {busy ? "…" : t(lang, "savePassword")}
          </button>
        </form>
      </div>
    </AuthLayout>
  );
}
