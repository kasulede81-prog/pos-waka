import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import type { Language } from "../../types";
import { AuthLayout } from "../../components/AuthLayout";
import { GoogleSignInButton } from "../../components/auth/GoogleSignInButton";
import { EnterprisePasswordField } from "../../components/auth/EnterprisePasswordField";
import { WakaPosLogo } from "../../components/brand/WakaLogo";
import { isGoogleAuthUiAvailable } from "../../lib/authFeatureFlags";
import { consumeAuthRedirectError, formatAuthError } from "../../lib/authConfig";
import { t } from "../../lib/i18n";
import {
  buildProgramJoinPath,
  isValidProgramCodeFormat,
  normalizeProgramCode,
} from "../../lib/loyalty/loyaltyPublicProgram";
import { posOrigin } from "../../lib/productHost";
import { hasSupabaseConfig } from "../../lib/supabase";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  initializing: boolean;
  isAuthenticated: boolean;
  onLogin: (identifier: string, password: string) => Promise<void>;
  onGoogleLogin: () => Promise<void>;
  mode: "supabase" | "local";
};

/**
 * Phase 2C — the customer sign-in surface on loyalty.waka.ug.
 *
 * A separate page rather than a host branch inside `LoginPage`, because the merchant page is a POS
 * surface: it carries the staff-PIN panel, the invite context and the "create a new shop" card,
 * none of which belong in front of a customer, and threading host conditionals through it would
 * put the merchant login at risk for no benefit. This page reuses the same primitives — the same
 * `GoogleSignInButton`, the same `onLogin` handler and therefore the same Supabase call, the same
 * error formatter — so there is one implementation of signing in, not two.
 *
 * Google is the primary action and email/password the fallback, as specified. The Google button is
 * rendered through the existing component, so it stays invisible until `VITE_ENABLE_GOOGLE_AUTH`
 * is switched on; this page does not enable anything by itself.
 */
export function LoyaltyLoginPage({
  lang,
  setLang,
  initializing,
  isAuthenticated,
  onLogin,
  onGoogleLogin,
  mode,
}: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => consumeAuthRedirectError());
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const navigate = useNavigate();

  const showGoogle = mode === "supabase" && hasSupabaseConfig && isGoogleAuthUiAvailable();

  // A signed-in member belongs on their member home; `/member` renders the registration form for a
  // session that is not a member yet, so a brand-new signup has somewhere to land.
  if (isAuthenticated) return <Navigate to="/member" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || googleBusy) return;
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

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col items-center text-center">
          <WakaPosLogo size="md" className="max-w-[min(100%,240px)]" />
          <h1 className="mt-5 text-2xl font-black tracking-tight text-foreground">
            {t(lang, "loyaltyLoginTitle")}
          </h1>
          <p className="mt-1.5 text-sm font-semibold text-muted-foreground">
            {t(lang, "loyaltyLoginSub")}
          </p>
        </div>

        <div className="mt-7 space-y-4">
          {/* Primary action. Renders only once Google sign-in is switched on for this deployment. */}
          {showGoogle ? (
            <>
              <GoogleSignInButton lang={lang} busy={googleBusy} onClick={googleSubmit} />
              <div className="flex items-center gap-3 py-0.5" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs font-semibold lowercase text-muted-foreground">
                  {t(lang, "loginOrDivider")}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          ) : null}

          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-bold text-foreground">
              {t(lang, "email")}
              <input
                type="email"
                className="waka-input mt-1.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t(lang, "registerEmailPh")}
                autoComplete="email"
                inputMode="email"
                required
                disabled={busy || googleBusy}
              />
            </label>

            <EnterprisePasswordField
              lang={lang}
              label={t(lang, "password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t(lang, "loginPasswordPh")}
              autoComplete="current-password"
              required
              minLength={1}
              loading={busy || googleBusy}
            />

            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-xs font-bold text-waka-700 hover:text-waka-800">
                {t(lang, "forgotPassword")}
              </Link>
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy || googleBusy}
              className="waka-btn-primary w-full"
            >
              {busy ? t(lang, "loginSigningIn") : t(lang, "signIn")}
            </button>
          </form>
        </div>
      </div>

      {/* "Have a WAKA Loyalty Code?" — the manual half of the same entry point a merchant QR
          opens. It navigates to /j/<code>, the exact URL the QR encodes, so typing and scanning
          cannot resolve to different programs. */}
      <form
        className="mt-6 rounded-2xl border border-border/80 bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const code = normalizeProgramCode(codeInput);
          if (!isValidProgramCodeFormat(code)) {
            setCodeError(t(lang, "loyaltyJoinNotFound"));
            return;
          }
          setCodeError(null);
          navigate(buildProgramJoinPath(code));
        }}
      >
        <p className="text-sm font-bold text-foreground">{t(lang, "loyaltyProgramEnterCode")}</p>
        <div className="mt-2 flex gap-2">
          <input
            value={codeInput}
            onChange={(e) => {
              setCodeInput(e.target.value);
              setCodeError(null);
            }}
            placeholder={t(lang, "loyaltyProgramPlaceholder")}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            data-testid="loyalty-program-code-input"
            className="waka-input min-w-0 flex-1 font-mono uppercase tracking-wider"
          />
          <button type="submit" className="waka-btn-primary shrink-0 px-4">
            {t(lang, "loyaltyProgramFind")}
          </button>
        </div>
        {codeError ? (
          <p role="alert" className="mt-2 text-xs font-semibold text-destructive">
            {codeError}
          </p>
        ) : (
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {t(lang, "loyaltyProgramCodeSub")}
          </p>
        )}
      </form>

      <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
        {t(lang, "loyaltyLoginNoAccount")}{" "}
        <Link to="/member/register" className="waka-link" data-testid="loyalty-login-register">
          {t(lang, "loyaltyLoginCreateAccount")}
        </Link>
      </p>

      {/* Cross-surface link. Absolute on purpose: this page is only ever rendered on
          loyalty.waka.ug, where a relative `/register` is not part of the customer app. */}
      <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">
        {t(lang, "loyaltyLoginRunShop")}{" "}
        <a href={`${posOrigin()}/register`} className="waka-link">
          {t(lang, "loginCreateNewAccount")}
        </a>
      </p>
    </AuthLayout>
  );
}

export default LoyaltyLoginPage;
