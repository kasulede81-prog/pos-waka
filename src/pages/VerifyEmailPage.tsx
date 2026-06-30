import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import type { Language } from "../types";
import { BusinessBuilderShell } from "../components/businessBuilder/BusinessBuilderShell";
import { BuilderField, BuilderPrimaryButton } from "../components/businessBuilder/BuilderField";
import { useBusinessBuilder } from "../context/BusinessBuilderContext";
import { registrationUnlocks } from "../lib/businessBuilder/businessSceneState";
import { t } from "../lib/i18n";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { isSupabaseEmailVerified } from "../lib/emailVerification";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  isAuthenticated: boolean;
  resendVerificationEmail: (email: string) => Promise<void>;
};

export function VerifyEmailPage({ lang, setLang, isAuthenticated, resendVerificationEmail }: Props) {
  const location = useLocation() as { state?: { email?: string; from?: string } };
  const presetEmail = location.state?.email ?? "";
  const [email, setEmail] = useState(presetEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [verifiedRedirect, setVerifiedRedirect] = useState(false);
  const { scene, patchScene } = useBusinessBuilder();

  useEffect(() => {
    patchScene({ emailPending: true, hasMailbox: true, mailboxOpen: false });
    const tmr = window.setTimeout(() => patchScene({ mailboxOpen: true }), 1200);
    return () => window.clearTimeout(tmr);
  }, [patchScene]);

  useEffect(() => {
    if (!isAuthenticated || !supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user && isSupabaseEmailVerified(data.user)) {
        setVerifiedRedirect(true);
      }
    });
  }, [isAuthenticated]);

  if (verifiedRedirect) {
    return <Navigate to={location.state?.from || "/"} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await resendVerificationEmail(email);
      setDone(true);
      patchScene({ mailboxOpen: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unlocks = registrationUnlocks(scene);

  return (
    <BusinessBuilderShell lang={lang} setLang={setLang} funnelStep="account" unlocks={unlocks}>
      <div className="rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-lg backdrop-blur-sm sm:rounded-[32px]">
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "verifyTitle")}</h1>
        <p className="mt-3 text-base font-medium text-stone-600">{t(lang, "builderEmailWaiting")}</p>
        {presetEmail ? (
          <p className="mt-2 text-sm font-semibold text-stone-800">{presetEmail}</p>
        ) : null}
        <p className="mt-3 rounded-2xl bg-waka-50 px-3 py-2 text-sm text-stone-700">{t(lang, "verifyOpenEmailHint")}</p>

        {!hasSupabaseConfig && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {t(lang, "supabaseMissing")}
          </div>
        )}

        {done ? (
          <p className="mt-6 text-center text-sm font-bold text-emerald-700">{t(lang, "verificationResent")}</p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            {!presetEmail ? (
              <BuilderField
                label={t(lang, "email")}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                complete={email.includes("@")}
              />
            ) : null}
            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
            <BuilderPrimaryButton type="submit" disabled={busy || !hasSupabaseConfig || !email.trim()}>
              {busy ? "…" : t(lang, "resendVerification")}
            </BuilderPrimaryButton>
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
    </BusinessBuilderShell>
  );
}
