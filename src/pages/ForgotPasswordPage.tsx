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
  isAuthenticated: boolean;
  requestPasswordReset: (email: string) => Promise<void>;
};

export function ForgotPasswordPage({ lang, setLang, isAuthenticated, requestPasswordReset }: Props) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (isAuthenticated) return <Navigate to="/" replace />;

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{t(lang, "forgotTitle")}</h1>
        <p className="mt-2 text-sm text-slate-600">{t(lang, "forgotSubtitle")}</p>

        {!hasSupabaseConfig ? (
          <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{t(lang, "supabaseMissing")}</p>
        ) : sent ? (
          <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-950">{t(lang, "resetEmailSent")}</p>
        ) : (
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
            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
            <button disabled={busy} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">
              {busy ? "…" : t(lang, "sendResetLink")}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="font-medium text-emerald-700 underline underline-offset-2">
            {t(lang, "backToLogin")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
