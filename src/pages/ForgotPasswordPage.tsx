import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import type { Language } from "../types";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { AuthLayout } from "../components/AuthLayout";
import { WAKA_LEGAL_COMPANY_NAME } from "../config/wakaSupport";
import { t } from "../lib/i18n";
import { hasSupabaseConfig } from "../lib/supabase";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  isAuthenticated: boolean;
  requestPasswordReset: (email: string) => Promise<void>;
};

export function ForgotPasswordPage({ lang, setLang, isAuthenticated, requestPasswordReset }: Props) {
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(identifier);
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
      <div className="mx-auto max-w-md rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col items-center text-center">
          <WakaPosLogo size="md" />
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {WAKA_LEGAL_COMPANY_NAME}
          </p>
          <h1 className="mt-4 text-2xl font-black text-foreground">{t(lang, "forgotTitle")}</h1>
          <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "forgotSubtitle")}</p>
          <p className="mt-2 text-xs font-medium text-muted-foreground">{t(lang, "forgotEmailOrPhoneHint")}</p>
        </div>

        {!hasSupabaseConfig ? (
          <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">
            {t(lang, "supabaseMissing")}
          </p>
        ) : sent ? (
          <p className="mt-6 rounded-xl border border-waka-200 bg-waka-50 px-3 py-3 text-sm text-waka-950" role="status">
            {t(lang, "resetEmailSent")}
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-sm font-bold text-foreground">
              {t(lang, "forgotIdentifierLabel")}
              <input
                type="text"
                inputMode="email"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                placeholder={t(lang, "forgotIdentifierPh")}
                className="mt-1.5 w-full min-h-[48px] rounded-xl border border-border px-4 py-3 text-base outline-none ring-waka-200 focus:border-waka-400 focus:ring-2"
              />
            </label>
            {error ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
                {error}
              </p>
            ) : null}
            <button
              disabled={busy}
              type="submit"
              className="w-full min-h-[52px] rounded-xl bg-waka-600 px-4 py-3 font-black text-white disabled:opacity-50"
            >
              {busy ? t(lang, "forgotSending") : t(lang, "sendResetLink")}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="inline-flex min-h-[44px] items-center font-bold text-waka-700 underline underline-offset-2">
            {t(lang, "backToLogin")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
