import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Mail, UserPlus, Users } from "lucide-react";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { GoogleSignInButton } from "../components/auth/GoogleSignInButton";
import { StaffShopGate } from "../components/auth/StaffShopGate";
import { EnterpriseStaffLoginPanel } from "../components/auth/EnterpriseStaffLoginPanel";
import { EnterprisePasswordField } from "../components/auth/EnterprisePasswordField";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { t } from "../lib/i18n";
import { formatAuthError, consumeAuthRedirectError } from "../lib/authConfig";
import { staffAcceptReturnPath } from "../lib/staffInvite";
import { isGoogleAuthUiAvailable } from "../lib/authFeatureFlags";
import { hasSupabaseConfig } from "../lib/supabase";
import { hardSignOutToLogin } from "../lib/authRecovery";
import {
  chooseStaffShop,
  clearStaffLoginIntent,
  hasStaffLoginIntent,
  listAccessibleStaffShops,
  markStaffLoginIntent,
  selectStaffShop,
  type StaffShopOption,
} from "../lib/staffLogin";
import { withTimeout } from "../lib/promiseTimeout";
import { reportAuthIssue } from "../lib/monitoring";
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

/**
 * Where a Google staff sign-in has got to.
 *
 *   idle      nothing started, or it failed — the staff form is shown
 *   resolving the session exists; the server is being asked which shops it may open
 *   choose    more than one shop — the person picks
 *   none      no shop this account can open
 *   enter     settled; fall through to the normal authenticated redirect
 *
 * Seeded from the persisted intent so the state survives the NATIVE full-page reload, which is
 * the only way this component learns that a staff sign-in rather than a merchant one just
 * happened.
 */
type StaffPhase = "idle" | "resolving" | "choose" | "none" | "enter";

/**
 * Outer ceiling for one shop selection, set just above the library's own (10s) so
 * `selectStaffShop`'s timeout normally wins and this one is a backstop for anything that hangs
 * outside it.
 *
 * WRITTEN AS A LITERAL ON PURPOSE. This was briefly `STAFF_SHOP_SWITCH_TIMEOUT_MS + 2_000`, which
 * evaluates an imported binding at MODULE-INIT time — and in a module graph this large that turns
 * an import cycle into a temporal-dead-zone `ReferenceError` at startup, which kills every handler
 * on the page while leaving the DOM painted. A local constant cannot depend on evaluation order.
 * The relationship is asserted in tests instead.
 */
const SELECT_SHOP_TIMEOUT_MS = 12_000;
/** Identity-compared sentinel: a timeout must be distinguishable from a real result. */
const TIMED_OUT = { ok: false, error: "timeout" } as const;

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

  /** The shared-terminal PIN form. Kept apart from the staff Google entry, never nested inside it. */
  const [showPinPanel, setShowPinPanel] = useState(false);

  const [staffPhase, setStaffPhase] = useState<StaffPhase>(() =>
    hasStaffLoginIntent() ? "resolving" : "idle",
  );
  const [staffShops, setStaffShops] = useState<StaffShopOption[]>([]);
  const [staffChoice, setStaffChoice] = useState<string | null>(null);
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);

  /**
   * Which staff attempt owns the busy flag.
   *
   * `staffBusy` is cleared from `finally` blocks, and a `finally` from an ABANDONED attempt can
   * still run after a newer one has started — clearing a flag that now belongs to somebody else,
   * or (the bug this fixes) never clearing at all because the promise it is waiting on never
   * settles. Every attempt takes a number here and only the attempt that still owns the number may
   * write the flag. A monotonically increasing counter cannot be confused by reordering.
   */
  const staffAttemptRef = useRef(0);
  /** Sign-out's own latch — deliberately NOT `staffBusy`, which may be stuck for other reasons. */
  const signOutRunningRef = useRef(false);

  const showGoogle = mode === "supabase" && hasSupabaseConfig && isGoogleAuthUiAvailable();
  /** Safe staff-accept return path (pathname + search). Never renders the raw token. */
  const staffInviteNext = staffAcceptReturnPath(searchParams.get("next"));
  const inviteLoginContext = Boolean(staffInviteNext);

  /**
   * A signed-out visit means no staff sign-in is in flight, so an intent left behind by an
   * abandoned attempt is dropped rather than waiting to misroute the next person who signs in.
   */
  useEffect(() => {
    if (!initializing && !isAuthenticated) clearStaffLoginIntent();
  }, [initializing, isAuthenticated]);

  /**
   * Once a staff Google sign-in has produced a session, ask the SERVER which shops it may open.
   * One shop continues straight through; several become a choice; none is an error and provisions
   * nothing. A pending invitation wins outright — that flow owns acceptance and its own routing.
   */
  useEffect(() => {
    if (!isAuthenticated || staffPhase !== "resolving") return undefined;

    // A pending invitation owns the return; the gate is inactive for it either way, so only the
    // marker needs clearing — no state change, and none synchronously in this effect body.
    if (staffInviteNext) {
      clearStaffLoginIntent();
      return undefined;
    }

    let cancelled = false;
    void (async () => {
      const choice = chooseStaffShop(await listAccessibleStaffShops());
      if (cancelled) return;

      /**
       * THE INVARIANT. `staffPhase === "choose"` (and `"none"`) means the gate now owns the screen,
       * so nothing that belonged to the Google attempt may still be holding it. The busy flag is
       * cleared FIRST, in the same batch as the phase change, so the picker can never render
       * disabled — a GIS popup that never answers must not be able to trap the person on a dead
       * screen. `staffAttemptRef` is advanced so the abandoned attempt's `finally` cannot later
       * write the flag again.
       */
      staffAttemptRef.current += 1;
      setStaffBusy(false);

      if (choice.kind === "none") {
        setStaffPhase("none");
        return;
      }
      if (choice.kind === "single") {
        clearStaffLoginIntent();
        setStaffPhase("enter");
        return;
      }
      setStaffShops(choice.shops);
      setStaffPhase("choose");
    })();

    return () => {
      cancelled = true;
    };
  }, [staffPhase, isAuthenticated, staffInviteNext]);

  /**
   * ============================ DECLARED BEFORE THE EARLY RETURN ============================
   * These two MUST be initialised on every render, because the staff gate below returns EARLY and
   * its buttons close over them. They used to be declared after that return, which put the bindings
   * in the temporal dead zone for exactly the render that needed them: every tap threw
   * `ReferenceError: Cannot access '<minified>' before initialization` from inside `onSelect`, and
   * the picker — shop rows AND sign-out — was completely inert while looking perfectly normal.
   *
   * `const` bindings are not hoisted. A handler referenced by a branch that returns before the
   * declaration is a live grenade, so anything the gate can call lives above it.
   * =========================================================================================
   */

  /**
   * Attach the chosen shop. `selectStaffShop` re-checks membership; a refusal stops here.
   *
   * Bounded by the library's own ceiling (`STAFF_SHOP_SWITCH_TIMEOUT_MS`), and bounded again here
   * by `withTimeout`, because a switch that never settles must still produce a terminal result —
   * otherwise the picker stays disabled forever with no way back. A timeout is shown as a retryable
   * error and changes NOTHING about the session; both shops stay selectable.
   */
  const selectShop = async (shopId: string) => {
    if (staffBusy) return;
    const attempt = ++staffAttemptRef.current;
    setStaffChoice(shopId);
    setStaffError(null);
    setStaffBusy(true);
    try {
      const result = await withTimeout(
        selectStaffShop(shopId),
        SELECT_SHOP_TIMEOUT_MS,
        TIMED_OUT,
      );
      if (staffAttemptRef.current !== attempt) return;
      if (!result.ok) {
        reportAuthIssue("staff_shop_select_failed", {
          errorCode: result.error,
          timedOut: result === TIMED_OUT,
        });
        setStaffChoice(null);
        setStaffError(
          result === TIMED_OUT ? t(lang, "staffShopSelectTimeout") : t(lang, "loginStaffNoAccessBody"),
        );
        return; // The picker stays put and both shops remain selectable — no redirect, no onboarding.
      }
      clearStaffLoginIntent();
      setStaffPhase("enter");
    } finally {
      if (staffAttemptRef.current === attempt) setStaffBusy(false);
    }
  };

  /**
   * Leave the staff gate entirely — sign the Google account out and start again.
   *
   * THE ESCAPE HATCH, so it must never depend on `staffBusy`. It was previously both gated on that
   * flag and rendered disabled by it, which meant a stuck flag removed the only way off the screen.
   * It latches on its own instead, and deliberately does not touch `staffBusy` at all — sign-out
   * hard-navigates, so there is no state left to restore.
   */
  const signOutStaff = async () => {
    if (signOutRunningRef.current) return;
    signOutRunningRef.current = true;
    clearStaffLoginIntent();
    try {
      await hardSignOutToLogin();
    } finally {
      signOutRunningRef.current = false;
    }
  };

  /**
   * The staff gate owns the screen between sign-in and the POS. It comes BEFORE the authenticated
   * redirect below, which otherwise fires the moment the session lands.
   */
  const staffGateActive =
    isAuthenticated &&
    !staffInviteNext &&
    (staffPhase === "resolving" || staffPhase === "choose" || staffPhase === "none");

  if (staffGateActive) {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8">
          {staffPhase === "choose" ? (
            <StaffShopGate
              state="choose"
              lang={lang}
              shops={staffShops}
              selectedShopId={staffChoice}
              busy={staffBusy}
              error={staffError}
              onSelect={(shopId) => void selectShop(shopId)}
              onSignOut={() => void signOutStaff()}
            />
          ) : staffPhase === "none" ? (
            <StaffShopGate
              state="none"
              lang={lang}
              signedInAs={null}
              busy={staffBusy}
              error={staffError}
              onSignOut={() => void signOutStaff()}
            />
          ) : (
            <StaffShopGate state="resolving" lang={lang} />
          )}
        </div>
      </AuthLayout>
    );
  }

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

  /**
   * Staff → Continue with Google.
   *
   * The SAME implementation as the owner button — `onGoogleLogin` is `useAuth.signInWithGoogle`,
   * which already selects the GIS popup with the nonce contract on web and the system-browser
   * OAuth return on native. Nothing about Google is reimplemented here; what differs is only what
   * happens afterwards, which the intent marker records for the native reload.
   */
  const staffGoogleSubmit = async () => {
    if (staffBusy || googleBusy) return;
    const attempt = ++staffAttemptRef.current;
    setStaffError(null);
    setError(null);
    markStaffLoginIntent();
    setStaffPhase("resolving");
    setStaffBusy(true);
    try {
      await onGoogleLogin();
    } catch (err) {
      // Only the attempt that still owns the flag may write it: the gate may already have advanced
      // and handed this screen to a session that arrived another way.
      if (staffAttemptRef.current !== attempt) return;
      clearStaffLoginIntent();
      setStaffPhase("idle");
      setStaffError(formatAuthError(err));
    } finally {
      if (staffAttemptRef.current === attempt) setStaffBusy(false);
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

  if (showPinPanel) {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8">
          <EnterpriseStaffLoginPanel
            lang={lang}
            onSubmit={onStaffLogin}
            listStaffShops={listStaffShops}
            rememberedStaffDevice={rememberedStaffDevice}
            onClearRemembered={onClearRememberedStaff}
            onBack={() => setShowPinPanel(false)}
          />
        </div>
      </AuthLayout>
    );
  }

  const roleSwitch = (
    <div
      role="group"
      aria-label={t(lang, "signIn")}
      className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/40 p-1"
    >
      <button
        type="button"
        aria-pressed={view === "owner"}
        onClick={() => setView("owner")}
        className={`min-h-[44px] rounded-lg px-3 text-sm font-black transition ${
          view === "owner" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
        }`}
        data-testid="login-role-owner"
      >
        {t(lang, "loginRoleOwner")}
      </button>
      <button
        type="button"
        aria-pressed={view === "staff"}
        onClick={() => setView("staff")}
        className={`min-h-[44px] rounded-lg px-3 text-sm font-black transition ${
          view === "staff" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
        }`}
        data-testid="login-role-staff"
      >
        {t(lang, "loginRoleStaff")}
      </button>
    </div>
  );

  // ---------------------------------------------------------------- STAFF
  if (view === "staff") {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-col items-center text-center">
            <WakaPosLogo size="md" className="max-w-[min(100%,240px)]" />
          </div>

          {roleSwitch}

          <h1 className="mt-6 text-lg font-black text-foreground">{t(lang, "loginStaffGoogleTitle")}</h1>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">{t(lang, "loginStaffGoogleSub")}</p>

          <div className="mt-4 space-y-3" data-testid="staff-login-google">
            {showGoogle ? (
              <GoogleSignInButton
                lang={lang}
                busy={staffBusy}
                onClick={() => void staffGoogleSubmit()}
              />
            ) : null}
            {staffError ? (
              <p role="alert" className="text-sm font-semibold text-red-700">
                {staffError}
              </p>
            ) : null}
          </div>

          {/* OFFLINE / SHARED TERMINAL — a device credential, not an account. Kept visually and
              structurally separate from the Google entry above so the two are never read as two
              competing accounts for one person. */}
          <div className="mt-8 border-t border-border pt-6">
            <h2 className="text-sm font-black text-foreground">{t(lang, "loginStaffOfflineTitle")}</h2>
            <p className="mt-1 text-xs font-medium text-muted-foreground">{t(lang, "loginStaffPinHint")}</p>
            <button
              type="button"
              onClick={() => setShowPinPanel(true)}
              className="mt-3 flex min-h-[48px] w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold text-foreground transition active:bg-muted"
              data-testid="login-shared-terminal-pin"
            >
              <span className="inline-flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
                {t(lang, "loginStaffPinEntry")}
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            </button>
          </div>

          {/* Support is deliberately NOT repeated here: it lives once, in the shared body of the
              default view, and the role switch above is one tap back to it. */}
        </div>
      </AuthLayout>
    );
  }

  // ---------------------------------------------------------------- OWNER
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

        {roleSwitch}

        {inviteLoginContext ? (
          <p
            className="mt-4 rounded-xl border border-waka-200 bg-waka-50 px-3 py-2 text-center text-xs font-semibold text-waka-900 dark:border-waka-800 dark:bg-waka-950/40 dark:text-waka-100"
            role="status"
            data-testid="login-invite-context"
          >
            {t(lang, "loginInviteContext")}
          </p>
        ) : null}

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

        {!inviteLoginContext ? (
          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs font-semibold lowercase text-muted-foreground">{t(lang, "loginOrDivider")}</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="space-y-1.5">
              <Link
                to="/register"
                className="flex min-h-[48px] w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold text-foreground transition active:bg-muted"
                data-testid="login-register-shop"
              >
                <span className="inline-flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {t(lang, "loginCreateNewAccount")}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Link>
              <p className="px-1 text-xs font-medium text-muted-foreground">{t(lang, "loginRegisterShopHint")}</p>
            </div>

            {/* Phase 2B — the public route into customer Loyalty signup. Deliberately a plain
                text line rather than a second card, so the merchant "create a new shop" action
                stays the primary choice on this page while a customer can still find their way
                in without knowing the URL. */}
            <p className="px-1 text-center text-xs font-medium text-muted-foreground">
              {t(lang, "loginMemberSignupHint")}{" "}
              <Link
                to="/member/register"
                className="font-bold text-waka-700 hover:text-waka-800"
                data-testid="login-member-register"
              >
                {t(lang, "loginMemberSignupCta")}
              </Link>
            </p>
          </div>
        ) : null}

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
