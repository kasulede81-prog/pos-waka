import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { t } from "../lib/i18n";
import {
  bootstrapPasswordRecoverySession,
  type PasswordRecoveryBootstrapStatus,
} from "../lib/passwordRecoverySession";
import { hasSupabaseConfig } from "../lib/supabase";
import { WAKA_LEGAL_COMPANY_NAME } from "../config/wakaSupport";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  mode: "supabase" | "local";
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export function ResetPasswordPage({ lang, setLang, mode, updatePassword, signOut }: Props) {
  const [bootstrapStatus, setBootstrapStatus] = useState<PasswordRecoveryBootstrapStatus>("loading");
  const [bootstrapMessage, setBootstrapMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (mode !== "supabase" || !hasSupabaseConfig) {
      setBootstrapStatus("invalid");
      setBootstrapMessage(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await bootstrapPasswordRecoverySession();
      if (cancelled) return;
      setBootstrapStatus(result.status);
      setBootstrapMessage(result.message ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

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
      await signOut();
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
        <div className="mx-auto max-w-md rounded-3xl border border-stone-200/80 bg-white p-6 shadow-waka-sm">
          <div className="flex flex-col items-center text-center">
            <WakaPosLogo size="md" />
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">{WAKA_LEGAL_COMPANY_NAME}</p>
          </div>
          <p className="mt-6 text-center text-sm font-semibold text-emerald-800">{t(lang, "passwordUpdated")}</p>
          <p className="mt-2 text-center text-sm text-stone-600">{t(lang, "resetPasswordSignInHint")}</p>
          <Link
            to="/login"
            className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-waka-600 px-4 text-sm font-black text-white"
          >
            {t(lang, "backToLogin")}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (bootstrapStatus === "loading") {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="mx-auto max-w-md rounded-3xl border border-stone-200/80 bg-white p-8 shadow-waka-sm text-center">
          <WakaPosLogo size="md" className="mx-auto" />
          <p className="mt-4 text-sm font-semibold text-stone-700">{t(lang, "resetPasswordVerifying")}</p>
        </div>
      </AuthLayout>
    );
  }

  if (bootstrapStatus === "expired" || bootstrapStatus === "invalid") {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="mx-auto max-w-md rounded-3xl border border-red-100 bg-white p-6 shadow-waka-sm">
          <div className="flex flex-col items-center text-center">
            <WakaPosLogo size="md" />
            <h1 className="mt-4 text-xl font-black text-stone-900">
              {bootstrapStatus === "expired" ? t(lang, "resetLinkExpiredTitle") : t(lang, "resetLinkInvalidTitle")}
            </h1>
          </div>
          <p className="mt-3 text-center text-sm text-stone-600">
            {bootstrapMessage ?? t(lang, "resetLinkInvalidBody")}
          </p>
          <Link
            to="/forgot-password"
            className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-waka-600 px-4 text-sm font-black text-white"
          >
            {t(lang, "sendResetLink")}
          </Link>
          <p className="mt-4 text-center text-sm">
            <Link to="/login" className="font-semibold text-waka-700 underline underline-offset-2">
              {t(lang, "backToLogin")}
            </Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="mx-auto max-w-md rounded-3xl border border-stone-200/80 bg-white p-6 shadow-waka-sm">
        <div className="flex flex-col items-center text-center">
          <WakaPosLogo size="md" />
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{WAKA_LEGAL_COMPANY_NAME}</p>
          <h1 className="mt-4 text-2xl font-black text-stone-900">{t(lang, "resetPasswordTitle")}</h1>
          <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "recoveryChooseSubtitle")}</p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "newPassword")}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              className="mt-1.5 w-full min-h-[48px] rounded-xl border border-stone-200 px-4 py-3 text-base outline-none ring-waka-200 focus:border-waka-400 focus:ring-2"
            />
          </label>
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "confirmPassword")}
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              className="mt-1.5 w-full min-h-[48px] rounded-xl border border-stone-200 px-4 py-3 text-base outline-none ring-waka-200 focus:border-waka-400 focus:ring-2"
            />
          </label>
          {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full min-h-[48px] rounded-xl bg-waka-600 px-4 py-3 font-black text-white disabled:opacity-50"
          >
            {busy ? "…" : t(lang, "savePassword")}
          </button>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="font-semibold text-waka-700 underline underline-offset-2">
            {t(lang, "backToLogin")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
