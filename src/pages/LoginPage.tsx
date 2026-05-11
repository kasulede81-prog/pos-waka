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
  onGoogleLogin: () => Promise<void>;
  mode: "supabase" | "local";
};

export function LoginPage({ lang, setLang, initializing, isAuthenticated, onLogin, onGoogleLogin, mode }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

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

  const googleSubmit = async () => {
    setGoogleBusy(true);
    setError(null);
    try {
      await onGoogleLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGoogleBusy(false);
    }
  };

  if (initializing) {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="h-10 w-40 rounded-xl waka-skeleton-bar" />
          <p className="text-center text-sm font-medium text-stone-600">{t(lang, "loadingAuth")}</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="rounded-3xl border border-stone-200/80 bg-white p-6 shadow-waka-sm">
        <h1 className="text-2xl font-black text-stone-900">{t(lang, "loginTitle")}</h1>

        {mode === "local" ? (
          <p className="mt-3 rounded-xl bg-stone-100 px-3 py-2 text-xs font-medium text-stone-700">{t(lang, "supabaseRegisterHint")}</p>
        ) : null}

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "supabase" && hasSupabaseConfig ? (
            <button
              type="button"
              onClick={googleSubmit}
              disabled={googleBusy}
              className="min-h-[52px] w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-3 text-base font-black text-stone-900 shadow-sm"
            >
              {googleBusy ? "…" : t(lang, "continueWithGoogle")}
            </button>
          ) : null}

          <label className="block text-sm font-medium">
            {t(lang, "email")}
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-xl border px-3 py-2 outline-none ring-waka-200 focus:ring"
            />
          </label>

          <div className="flex items-center justify-between text-sm">
            <label className="font-medium">
              {t(lang, "password")}
            </label>
            {mode === "supabase" && hasSupabaseConfig ? (
              <Link to="/forgot-password" className="font-medium text-waka-700 underline underline-offset-2">
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
            className="mt-1 w-full rounded-xl border px-3 py-2 outline-none ring-waka-200 focus:ring"
          />

          {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

          <button
            disabled={busy}
            type="submit"
            className="min-h-[52px] w-full rounded-2xl bg-waka-600 px-4 py-3.5 text-lg font-black text-white shadow-waka-sm transition-waka active:scale-[0.99] disabled:opacity-50 motion-reduce:active:scale-100"
          >
            {busy ? "…" : t(lang, "signIn")}
          </button>
        </form>

        <div className="mt-6 rounded-2xl bg-stone-50 p-4 text-center ring-1 ring-stone-100">
          <p className="text-sm font-medium text-stone-600">{t(lang, "haveAccount")}</p>
          <Link
            to="/register"
            className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-900 shadow-sm transition-waka active:bg-stone-50"
          >
            {t(lang, "createAccount")}
          </Link>
        </div>

        {!hasSupabaseConfig && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">{t(lang, "supabaseMissing")}</p>
        )}

        <p className="mt-8 text-center">
          <Link
            to="/support"
            className="inline-flex min-h-[48px] items-center justify-center text-base font-bold text-waka-800 underline underline-offset-2"
          >
            {t(lang, "supportLoginFooter")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
