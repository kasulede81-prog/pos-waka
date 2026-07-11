import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowRight, Headphones, Mail, UserPlus, Users } from "lucide-react";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { GoogleSignInButton } from "../components/auth/GoogleSignInButton";
import { EnterpriseStaffLoginPanel } from "../components/auth/EnterpriseStaffLoginPanel";
import { EnterprisePasswordField } from "../components/auth/EnterprisePasswordField";
import { WakaSymbolIcon } from "../components/brand/WakaLogo";
import { t } from "../lib/i18n";
import { formatAuthError, consumeAuthRedirectError } from "../lib/authConfig";
import { isGoogleAuthUiAvailable } from "../lib/authFeatureFlags";
import { hasSupabaseConfig } from "../lib/supabase";
import type { CachedShop, RememberedStaffDevice, StaffLoginInput } from "../lib/staffOfflineAuth";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";

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
  "w-full min-h-[48px] rounded-xl border border-border bg-card py-3 pl-10 pr-4 text-base text-foreground outline-none ring-waka-200 placeholder:text-muted-foreground focus:border-waka-400 focus:ring-2 dark:bg-foreground dark:text-background";

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
  const [view, setView] = useState<"owner" | "staff">("owner");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(() => consumeAuthRedirectError());
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const showGoogle = mode === "supabase" && hasSupabaseConfig && isGoogleAuthUiAvailable();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const canOwnerSignIn = mode === "supabase" || mode === "local";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
        <div className="flex flex-col items-center gap-3 py-12">
          <div className="h-14 w-14 rounded-full bg-waka-100 waka-skeleton-bar dark:bg-waka-950/40" />
          <p className="text-center text-sm font-medium text-muted-foreground">{t(lang, "loadingAuth")}</p>
        </div>
      </AuthLayout>
    );
  }

  if (view === "staff") {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="rounded-[1.75rem] border border-border/70 bg-card p-6 shadow-[0_8px_40px_rgba(28,25,23,0.07)] sm:p-8 dark:bg-foreground">
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
      <div className="rounded-[1.75rem] border border-border/70 bg-card p-6 shadow-[0_8px_40px_rgba(28,25,23,0.07)] sm:p-8 dark:bg-foreground">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-waka-50 ring-1 ring-waka-100 dark:bg-waka-950/40 dark:ring-waka-900/50">
          <WakaSymbolIcon size="md" className="!h-9 !w-9" />
        </div>

        <h1 className="mt-5 text-center text-2xl font-black text-foreground dark:text-background">
          {t(lang, "loginWelcomeTitle")}
        </h1>
        <p className="mt-2 text-center text-sm font-medium text-muted-foreground dark:text-muted-foreground">
          <LoginWelcomeSub lang={lang} />
        </p>

        {mode === "local" ? (
          <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-center text-xs font-medium text-muted-foreground dark:bg-foreground dark:text-muted-foreground">
            {t(lang, "supabaseRegisterHint")}
          </p>
        ) : null}

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "supabase" && hasSupabaseConfig ? (
            <p className="text-center text-xs font-medium text-muted-foreground">{t(lang, "loginOwnerHint")}</p>
          ) : null}

          {showGoogle ? (
            <>
              <GoogleSignInButton lang={lang} busy={googleBusy} onClick={googleSubmit} />
              <div className="flex items-center gap-3 py-0.5" aria-hidden>
                <span className="h-px flex-1 bg-muted dark:bg-stone-700" />
                <span className="text-xs font-semibold lowercase text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-muted dark:bg-stone-700" />
              </div>
            </>
          ) : null}

          <label className="block text-sm font-bold text-foreground dark:text-muted-foreground">
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
            label={
              <span className="flex items-center justify-between gap-2">
                {t(lang, "password")}
                {mode === "supabase" && hasSupabaseConfig ? (
                  <Link
                    to="/forgot-password"
                    className="text-xs font-semibold text-waka-600 hover:text-waka-700 dark:text-waka-400"
                  >
                    {t(lang, "forgotPassword")}
                  </Link>
                ) : null}
              </span>
            }
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder={t(lang, "loginPasswordPh")}
            loading={busy}
          />

          <div className="flex items-center justify-between gap-3 pt-0.5">
            <WakaSwitch
              checked={rememberMe}
              onCheckedChange={setRememberMe}
              label={t(lang, "loginRememberMe")}
              className="text-sm font-semibold text-muted-foreground dark:text-muted-foreground"
            />
            <span className="text-xs font-medium text-muted-foreground dark:text-muted-foreground">{t(lang, "loginKeepSignedIn")}</span>
          </div>

          {error ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}{" "}
              {error.toLowerCase().includes("confirm your email") ? (
                <Link to="/verify-email" state={{ email }} className="font-bold underline">
                  Resend verification
                </Link>
              ) : null}
            </p>
          ) : null}

          <button
            disabled={busy}
            type="submit"
            className="flex min-h-[52px] w-full items-center justify-between rounded-xl bg-waka-600 px-5 py-3.5 text-base font-black text-white shadow-md shadow-waka-600/20 transition active:scale-[0.99] disabled:opacity-50 motion-reduce:active:scale-100"
          >
            <span>{busy ? "…" : t(lang, "signIn")}</span>
            <ArrowRight className="h-5 w-5" aria-hidden />
          </button>
        </form>

        <div className="mt-6">
          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-muted dark:bg-stone-700" />
            <span className="text-xs font-semibold lowercase text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-muted dark:bg-stone-700" />
          </div>
          <button
            type="button"
            onClick={() => setView("staff")}
            className="mt-4 flex min-h-[48px] w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold text-foreground shadow-sm transition active:bg-muted dark:bg-foreground dark:text-background"
          >
            <span className="inline-flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground dark:text-muted-foreground" aria-hidden />
              {t(lang, "staffLoginTitle")}
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </button>
          <Link
            to="/register"
            className="mt-3 flex min-h-[48px] w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold text-foreground shadow-sm transition active:bg-muted dark:bg-foreground dark:text-background"
          >
            <span className="inline-flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-muted-foreground dark:text-muted-foreground" aria-hidden />
              {t(lang, "loginCreateNewAccount")}
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        </div>

        {!hasSupabaseConfig && canOwnerSignIn ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {t(lang, "supabaseMissing")}
          </p>
        ) : null}

        <div className="mt-6 rounded-2xl bg-waka-50/90 px-4 py-3.5 ring-1 ring-waka-100 dark:bg-waka-950/30 dark:ring-waka-900/40">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-waka-100 text-waka-600 dark:bg-waka-900/50 dark:text-waka-400">
              <Headphones className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground dark:text-background">{t(lang, "supportLoginFooter")}</p>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground dark:text-muted-foreground">{t(lang, "loginHelpSub")}</p>
              <Link
                to="/support"
                className="mt-1.5 inline-flex items-center gap-1 text-sm font-bold text-waka-600 hover:text-waka-700 dark:text-waka-400"
              >
                {t(lang, "loginContactSupport")}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
}

function LoginWelcomeSub({ lang }: { lang: Language }) {
  const text = t(lang, "loginWelcomeSub");
  const parts = text.split("Waka POS");
  if (parts.length === 2) {
    return (
      <>
        {parts[0]}
        <span className="font-bold text-waka-600 dark:text-waka-400">Waka POS</span>
        {parts[1]}
      </>
    );
  }
  return <>{text}</>;
}
