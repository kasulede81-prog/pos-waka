import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { t } from "../lib/i18n";
import { hasSupabaseConfig } from "../lib/supabase";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  initializing: boolean;
  isAuthenticated: boolean;
  onLogin: (email: string, password: string) => Promise<void>;
  mode: "supabase" | "local";
};

export function LoginPage({ lang, setLang, initializing, isAuthenticated, onLogin, mode }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (initializing) {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <p className="text-center text-sm text-slate-600">{t(lang, "loadingAuth")}</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{t(lang, "loginTitle")}</h1>

        {mode === "local" ? (
          <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">{t(lang, "supabaseRegisterHint")}</p>
        ) : null}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">
            {t(lang, "email")}
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-xl border px-3 py-2 outline-none ring-emerald-200 focus:ring"
            />
          </label>

          <div className="flex items-center justify-between text-sm">
            <label className="font-medium">
              {t(lang, "password")}
            </label>
            {mode === "supabase" && hasSupabaseConfig ? (
              <Link to="/forgot-password" className="font-medium text-emerald-700 underline underline-offset-2">
                {t(lang, "forgotPassword")}
              </Link>
            ) : null}
          </div>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 w-full rounded-xl border px-3 py-2 outline-none ring-emerald-200 focus:ring"
          />

          {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

          <button disabled={busy} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">
            {busy ? "…" : t(lang, "signIn")}
          </button>
        </form>

        <div className="mt-6 rounded-xl bg-slate-50 p-4 text-center">
          <p className="text-sm text-slate-600">{t(lang, "haveAccount")}</p>
          <Link to="/register" className="mt-2 inline-block w-full rounded-xl border bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm">
            {t(lang, "createAccount")}
          </Link>
        </div>

        {!hasSupabaseConfig && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">{t(lang, "supabaseMissing")}</p>
        )}
      </div>
    </AuthLayout>
  );
}
