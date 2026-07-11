import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { EnterprisePasswordField } from "../components/auth/EnterprisePasswordField";
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
        <div className="mx-auto max-w-md rounded-3xl border border-border/80 bg-card p-6 shadow-waka-sm">
          <div className="flex flex-col items-center text-center">
            <WakaPosLogo size="md" />
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{WAKA_LEGAL_COMPANY_NAME}</p>
          </div>
          <p className="mt-6 text-center text-sm font-semibold text-emerald-800">{t(lang, "passwordUpdated")}</p>
          <p className="mt-2 text-center text-sm text-muted-foreground">{t(lang, "resetPasswordSignInHint")}</p>
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
        <div className="mx-auto max-w-md rounded-3xl border border-border/80 bg-card p-8 shadow-waka-sm text-center">
          <WakaPosLogo size="md" className="mx-auto" />
          <p className="mt-4 text-sm font-semibold text-muted-foreground">{t(lang, "resetPasswordVerifying")}</p>
        </div>
      </AuthLayout>
    );
  }

  if (bootstrapStatus === "expired" || bootstrapStatus === "invalid") {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="mx-auto max-w-md rounded-3xl border border-red-100 bg-card p-6 shadow-waka-sm">
          <div className="flex flex-col items-center text-center">
            <WakaPosLogo size="md" />
            <h1 className="mt-4 text-xl font-black text-foreground">
              {bootstrapStatus === "expired" ? t(lang, "resetLinkExpiredTitle") : t(lang, "resetLinkInvalidTitle")}
            </h1>
          </div>
          <p className="mt-3 text-center text-sm text-muted-foreground">
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
      <div className="mx-auto max-w-md rounded-3xl border border-border/80 bg-card p-6 shadow-waka-sm">
        <div className="flex flex-col items-center text-center">
          <WakaPosLogo size="md" />
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{WAKA_LEGAL_COMPANY_NAME}</p>
          <h1 className="mt-4 text-2xl font-black text-foreground">{t(lang, "resetPasswordTitle")}</h1>
          <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "recoveryChooseSubtitle")}</p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <EnterprisePasswordField
            lang={lang}
            label={t(lang, "newPassword")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            showStrength
            loading={busy}
            error={error}
          />
          <EnterprisePasswordField
            lang={lang}
            label={t(lang, "confirmPassword")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            loading={busy}
          />
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
