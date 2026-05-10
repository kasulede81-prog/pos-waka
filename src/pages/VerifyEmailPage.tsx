import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { t } from "../lib/i18n";
import { hasSupabaseConfig } from "../lib/supabase";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  isAuthenticated: boolean;
  resendVerificationEmail: (email: string) => Promise<void>;
};

export function VerifyEmailPage({ lang, setLang, isAuthenticated, resendVerificationEmail }: Props) {
  const location = useLocation() as { state?: { email?: string } };
  const presetEmail = location.state?.email ?? "";
  const [email, setEmail] = useState(presetEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await resendVerificationEmail(email);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{t(lang, "verifyTitle")}</h1>
        <p className="mt-3 text-sm text-slate-600">{t(lang, "verifySubtitle")}</p>

        {!hasSupabaseConfig && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {t(lang, "supabaseMissing")}
          </div>
        )}

        {done ? (
          <p className="mt-6 text-sm font-medium text-emerald-700">{t(lang, "verificationResent")}</p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-sm">
              {t(lang, "email")}
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || !hasSupabaseConfig}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 disabled:opacity-50"
            >
              {busy ? "…" : t(lang, "resendVerification")}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="font-medium text-emerald-700 underline">
            {t(lang, "backToLogin")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
