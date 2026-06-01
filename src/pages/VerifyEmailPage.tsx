import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Mail } from "lucide-react";
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
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-waka-100 text-waka-700">
          <Mail className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="mt-4 text-center text-2xl font-black text-stone-950">{t(lang, "verifyTitle")}</h1>
        <p className="mt-3 text-center text-base font-medium text-stone-600">{t(lang, "verifyActivateLead")}</p>
        {presetEmail ? (
          <p className="mt-2 text-center text-sm font-semibold text-stone-800">{presetEmail}</p>
        ) : null}
        <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-600">{t(lang, "verifyOpenEmailHint")}</p>

        {!hasSupabaseConfig && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {t(lang, "supabaseMissing")}
          </div>
        )}

        {done ? (
          <p className="mt-6 text-center text-sm font-bold text-waka-700">{t(lang, "verificationResent")}</p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            {!presetEmail ? (
              <label className="block text-sm font-bold text-stone-700">
                {t(lang, "email")}
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 w-full min-h-[48px] rounded-xl border border-stone-200 px-4 py-3 text-base outline-none ring-waka-200 focus:border-waka-400 focus:ring-2"
                />
              </label>
            ) : null}
            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || !hasSupabaseConfig || !email.trim()}
              className="min-h-[52px] w-full rounded-2xl bg-waka-600 px-4 py-3.5 text-lg font-black text-white shadow-waka-sm disabled:opacity-50"
            >
              {busy ? "…" : t(lang, "resendVerification")}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-stone-600">
          {t(lang, "verifyAfterConfirm")}{" "}
          <Link to="/login" className="font-bold text-waka-700 underline underline-offset-2">
            {t(lang, "signIn")}
          </Link>
        </p>

        <p className="mt-4 text-center">
          <Link
            to="/support"
            className="inline-flex min-h-[44px] items-center justify-center text-sm font-bold text-waka-800 underline underline-offset-2"
          >
            {t(lang, "supportLoginFooter")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
