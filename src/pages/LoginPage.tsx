import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Mail, UserPlus, Users } from "lucide-react";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { GoogleSignInButton } from "../components/auth/GoogleSignInButton";
import { EnterpriseStaffLoginPanel } from "../components/auth/EnterpriseStaffLoginPanel";
import { EnterprisePasswordField } from "../components/auth/EnterprisePasswordField";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { t } from "../lib/i18n";
import { formatAuthError, consumeAuthRedirectError } from "../lib/authConfig";
import { staffAcceptReturnPath } from "../lib/staffInvite";
import { isGoogleAuthUiAvailable } from "../lib/authFeatureFlags";
import { hasSupabaseConfig } from "../lib/supabase";
import type { CachedShop, RememberedStaffDevice, StaffLoginInput } from "../lib/staffOfflineAuth";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  initializing: boolean;
  isAuthenticated: boolean;
  onLogin: (identifier: string, password: string) => Promise<void>;
  onGoogleLogin: () => Promise<void>;
  onStaffLogin: (input: StaffLoginInput) => Promise<void>;
  listStaffShops: () => Promise<CachedShop[]>;
  rememberedStaffDevice: RememberedStaffDevice | null;
  onClearRememberedStaff: () => void;
  mode: "supabase" | "local";
};

const fieldClass =
  "w-full min-h-[48px] rounded-xl border border-border bg-card py-3 pl-10 pr-4 text-base text-foreground outline-none ring-waka-200 placeholder:text-muted-foreground focus:border-waka-400 focus:ring-2 dark:bg-card dark:text-foreground";

export function LoginPage({
  lang,
  setLang,
  initializing,
  isAuthenticated,
  onLogin,
  onGoogleLogin,
  onStaffLogin,
  listStaffShops,
  rememberedStaffDevice,
  onClearRememberedStaff,
  mode,
}: Props) {
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<"owner" | "staff">("owner");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => consumeAuthRedirectError());
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const showGoogle = mode === "supabase" && hasSupabaseConfig && isGoogleAuthUiAvailable();
  const staffInviteNext = staffAcceptReturnPath(searchParams.get("next"));

  if (isAuthenticated) {
    return <Navigate to={staffInviteNext ?? "/"} replace />;
  }

  const canOwnerSignIn = mode === "supabase" || mode === "local";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onLogin(email, password);
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const googleSubmit = async () => {
    if (googleBusy || busy) return;
    setGoogleBusy(true);
    setError(null);
    try {
      await onGoogleLogin();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setGoogleBusy(false);
    }
  };

  if (initializing) {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="flex flex-col items-center gap-3 py-12" aria-busy="true" aria-live="polite">
          <div className="h-14 w-14 rounded-full bg-waka-100 waka-skeleton-bar dark:bg-waka-950/40" />
          <p className="text-center text-sm font-medium text-muted-foreground">{t(lang, "loadingAuth")}</p>
        </div>
      </AuthLayout>
    );
  }

  if (view === "staff") {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8">
          <EnterpriseStaffLoginPanel
            lang={lang}
            onSubmit={onStaffLogin}
            listStaffShops={listStaffShops}
            rememberedStaffDevice={rememberedStaffDevice}
            onClearRemembered={onClearRememberedStaff}
            onBack={() => setView("owner")}
          />
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col items-center text-center">
          <WakaPosLogo size="md" className="max-w-[min(100%,240px)]" />
          <h1 className="mt-5 text-2xl font-black tracking-tight text-foreground sm:text-[1.65rem]">
            {t(lang, "loginWelcomeTitle")}
          </h1>
          <p className="mt-1.5 text-sm font-semibold text-muted-foreground">{t(lang, "loginWelcomeSub")}</p>
        </div>

        {mode === "local" ? (
          <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-center text-xs font-medium text-muted-foreground">
            {t(lang, "supabaseRegisterHint")}
          </p>
        ) : null}

        <form onSubmit={submit} className="mt-7 space-y-4">
          {mode === "supabase" && hasSupabaseConfig ? (
            <p className="text-center text-xs font-medium text-muted-foreground">{t(lang, "loginOwnerHint")}</p>
          ) : null}

          {showGoogle ? (
            <>
              <GoogleSignInButton lang={lang} busy={googleBusy} onClick={googleSubmit} />
              <div className="flex items-center gap-3 py-0.5" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs font-semibold lowercase text-muted-foreground">{t(lang, "loginOrDivider")}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          ) : null}

          <label className="block text-sm font-bold text-foreground">
            {t(lang, "email")}
            <div className="relative mt-1.5">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder={t(lang, "registerEmailPh")}
                className={fieldClass}
              />
            </div>
          </label>

          <EnterprisePasswordField
            lang={lang}
            label={t(lang, "password")}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={1}
            placeholder={t(lang, "loginPasswordPh")}
            loading={busy}
          />

          {mode === "supabase" && hasSupabaseConfig ? (
            <div className="flex justify-end">
              <Link
                to="/forgot-password"
                className="inline-flex min-h-[44px] items-center text-sm font-bold text-waka-700 hover:text-waka-800"
              >
                {t(lang, "forgotPassword")}
              </Link>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
              {error}{" "}
              {error.toLowerCase().includes("confirm your email") ? (
                <Link to="/verify-email" state={{ email }} className="font-bold underline">
                  {t(lang, "loginResendVerification")}
                </Link>
              ) : null}
            </p>
          ) : null}

          <button
            disabled={busy || googleBusy}
            type="submit"
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-waka-600 px-5 py-3.5 text-base font-black text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50 motion-reduce:active:scale-100"
          >
            <span>{busy ? t(lang, "loginSigningIn") : t(lang, "signIn")}</span>
            {!busy ? <ArrowRight className="h-5 w-5" aria-hidden /> : null}
          </button>
        </form>

        <div className="mt-8 space-y-3">
          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-semibold lowercase text-muted-foreground">{t(lang, "loginOrDivider")}</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <button
            type="button"
            onClick={() => setView("staff")}
            className="flex min-h-[48px] w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold text-foreground transition active:bg-muted"
          >
            <span className="inline-flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t(lang, "loginStaffPinEntry")}
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </button>

          <Link
            to="/register"
            className="flex min-h-[48px] w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold text-foreground transition active:bg-muted"
          >
            <span className="inline-flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t(lang, "loginCreateNewAccount")}
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        </div>

        {!hasSupabaseConfig && canOwnerSignIn ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950" role="status">
            {t(lang, "supabaseMissing")}
          </p>
        ) : null}

        <p className="mt-6 text-center text-xs font-medium text-muted-foreground">
          <Link to="/support" className="font-bold text-waka-700 hover:text-waka-800">
            {t(lang, "loginContactSupport")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
