import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { EnterpriseSpinner } from "../components/enterprise/EnterpriseSpinner";
import { NameReviewFields } from "../components/auth/NameReviewFields";
import { requestGoogleIdTokenWithNonce } from "../lib/googleIdentity";
import { composeFullName, namePartsProblem, needsNameReview, reviewPrefill, type NameParts } from "../lib/nameReview";
import { confirmWakaName } from "../lib/wakaName";
import { signInForStaffInvite } from "../lib/staffInviteGoogleAuth";
import { signInWithGoogleNative } from "../lib/nativeGoogleAuth";
import { isNativeApp } from "../lib/nativeApp";
import { authDevLog } from "../lib/authConfig";
import { reportAuthIssue } from "../lib/monitoring";
import {
  acceptStaffInviteToken,
  clearStaffInviteToken,
  persistStaffInviteToken,
} from "../lib/staffInvite";
import {
  createStaffInviteAcceptAttemptController,
  shouldStartStaffInviteAccept,
} from "../lib/staffInviteAcceptAttempt";
import { runStaffInviteAcceptFlow } from "../lib/staffInviteAcceptFlow";
import { hydrateStaffAuthWorkspace } from "../lib/staffAuthHydrate";
import { supabase } from "../lib/supabase";
import { WAKA_LEGAL_COMPANY_NAME } from "../config/wakaSupport";
import type { Language } from "../types";
import { t } from "../lib/i18n";

type Props = {
  lang: Language;
  isAuthenticated: boolean;
  initializing: boolean;
  onLogin: (email: string, password: string) => Promise<void>;
};

type Phase = "ready" | "name" | "accepting" | "success" | "need_verify" | "error";

/**
 * Staff invitation acceptance — Google-first.
 *
 * Acceptance requires a Google identity whose email matches the invitation, so
 * this page deliberately offers no password path: no sign-in form, no sign-up,
 * no "use another email". The authoritative comparison happens server-side in
 * shop_accept_staff_invite(); everything here is presentation. Email/password
 * authentication elsewhere in DKASU is untouched.
 */
export function StaffAcceptPage({ lang, isAuthenticated, initializing }: Props) {
  const [params] = useSearchParams();
  const tokenFromUrl = (params.get("token") ?? "").trim();
  const [phase, setPhase] = useState<Phase>("ready");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wrongAccount, setWrongAccount] = useState<string | null>(null);
  /**
   * A first-time Google user is naming themselves, so acceptance must wait.
   *
   * DELIBERATELY NOT `phase`. The accept effect must re-run when this releases, but `phase` changes
   * on transitions the effect has no business reacting to — `ready → accepting` happens *inside* an
   * in-flight attempt, and putting `phase` in the dependency list would re-run the effect while its
   * own attempt is running. This flag moves exactly twice: set before the attempt exists, cleared to
   * let it start. That is the whole dependency.
   */
  const [awaitingName, setAwaitingName] = useState(false);
  /** The merchant name step's own state, identical in shape to `StartBusinessPage`'s. */
  const [parts, setParts] = useState<NameParts>({ firstName: "", lastName: "" });
  const [partError, setPartError] = useState<{ field: "firstName" | "lastName"; message: string } | null>(null);
  const attemptRef = useRef(createStaffInviteAcceptAttemptController());
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    if (tokenFromUrl) persistStaffInviteToken(tokenFromUrl);
    // Drop the token from the visible URL once it has been captured. It stays in
    // sessionStorage (needed for reloads and the redirect callback), so scrubbing
    // the address bar does not lose it. Never logged either way.
    if (typeof window !== "undefined" && tokenFromUrl && window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [tokenFromUrl]);

  const token =
    tokenFromUrl ||
    (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("waka.staffInvite.token") : null) ||
    "";

  useEffect(() => {
    reportAuthIssue("invite_accept_page_open", { hasToken: Boolean(tokenFromUrl || token) });
  }, []);

  // True unmount only — dependency rerenders must not cancel in-flight acceptance.
  useEffect(() => {
    const controller = attemptRef.current;
    controller.noteMounted();
    return () => {
      controller.markUnmounted();
    };
  }, []);

  useEffect(() => {
    const controller = attemptRef.current;
    /**
     * A FIRST-TIME Google user names themselves BEFORE the invitation is accepted.
     *
     * This is the merchant flow's own step, reused rather than reimplemented: `needsNameReview`
     * decides, `confirmWakaName` writes `waka_full_name` — a key Google never touches — so the
     * Google profile name can never become the DKASU staff name by default. It runs here, ahead of
     * acceptance, because acceptance is what creates the staff/membership rows and the name should
     * be settled before it. The invitation token is untouched either way.
     */
    if (awaitingName) return;
    if (
      !shouldStartStaffInviteAccept({
        initializing,
        isAuthenticated,
        token,
        inFlight: controller.isInFlight(),
        settledToken: controller.settledToken(),
      })
    ) {
      if (initializing) {
        reportAuthIssue("invite_auth_wait", {});
      } else if (isAuthenticated && token) {
        reportAuthIssue("invite_auth_ready", {});
      }
      return;
    }

    const attemptId = controller.tryBegin(token);
    if (attemptId == null) return;

    reportAuthIssue("invite_accept_start", {});
    setPhase("accepting");
    setMessage(null);

    void (async () => {
      reportAuthIssue("invite_rpc_start", {});
      const result = await runStaffInviteAcceptFlow({
        token,
        acceptInviteToken: acceptStaffInviteToken,
        getAuthUserId: async () => {
          const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
          return data.user?.id ?? null;
        },
        hydrateStaffWorkspace: async (userId) => {
          reportAuthIssue("invite_hydrate_start", {});
          await hydrateStaffAuthWorkspace(userId);
        },
        clearStoredInviteToken: clearStaffInviteToken,
      });

      controller.complete(attemptId, () => {
        controller.markSettled(token);
        if (result.ok) {
          if (result.hydrateDegraded) {
            reportAuthIssue("invite_hydrate_timeout", {});
          } else {
            reportAuthIssue("invite_rpc_success", {});
          }
          reportAuthIssue("invite_success", {});
          setPhase("success");
          return;
        }

        reportAuthIssue("invite_rpc_error", {
          error: result.error === "timeout" ? "timeout" : "accept_failed",
        });
        if (result.error === "timeout") {
          reportAuthIssue("invite_timeout", {});
        }
        reportAuthIssue("invite_error", {});
        // A wrong-account attempt is rejected server-side. Surface who is signed
        // in so the user can switch accounts; no invitation details are revealed
        // beyond what the invitation email itself already contains.
        if (result.error === "email_mismatch") {
          void supabase?.auth
            .getUser()
            .then(({ data }) => setWrongAccount(data.user?.email ?? null))
            .catch(() => setWrongAccount(null));
        }
        setPhase("error");
        setMessage(acceptErrorMessage(langRef.current, result.error));
      });
    })();
  }, [initializing, isAuthenticated, token, awaitingName]);

  /**
   * Google-first sign-in. On success the auto-accept effect above runs (it watches
   * isAuthenticated), so acceptance logic is not duplicated here.
   *
   * PLATFORM SPLIT — `signInForStaffInvite` picks between the two implementations that already
   * exist, and neither is reimplemented here:
   *
   *   WEB    GIS popup → `signInWithIdToken` with the RAW nonce. The ID token is bound to a
   *          per-attempt nonce Supabase verifies, so a replayed or substituted token is rejected.
   *          Supabase hashes the nonce it receives and compares that to the claim in the token,
   *          and Google was given that hash — never pass the hashed form here.
   *   NATIVE Supabase OAuth in the system browser, returning through `wakapos://callback` — the
   *          same implementation merchant sign-in uses. The GIS popup is not used in the
   *          Capacitor WebView, where it does not work reliably.
   */
  const signInWithGoogle = async () => {
    if (busy || !supabase) return;
    setBusy(true);
    setMessage(null);
    setWrongAccount(null);
    const client = supabase;
    const platform = isNativeApp() ? "native" : "web";
    try {
      // Persisted BEFORE the round trip: on native the WebView leaves for the system browser and
      // returns through the deep link, so this is what carries the invitation across.
      persistStaffInviteToken(token);

      const via = await signInForStaffInvite({
        isNativePlatform: isNativeApp,
        signInWithNativeGoogle: signInWithGoogleNative,
        signInWithWebGoogle: async () => {
          const { idToken, nonce } = await requestGoogleIdTokenWithNonce();
          const { error } = await client.auth.signInWithIdToken({
            provider: "google",
            token: idToken,
            nonce,
          });
          if (error) throw error;
        },
      });

      if (via === "native") {
        // On the happy path the deep-link return reloads the WebView into /auth/callback, which
        // hands control back to this page with the stored token — so reaching this line means the
        // flow finished without that reload. Require a session before continuing either way.
        const { data } = await client.auth.getSession();
        if (!data.session) throw new Error(t(lang, "staffInviteAcceptFailed"));
      }

      reportAuthIssue("invite_google_signin_ok", { platform: via });

      /**
       * FIRST-TIME GOOGLE USER → their own name, from the merchant flow.
       *
       * `needsNameReview` is the SAME decision the merchant signup makes: it is true only when this
       * account has never CONFIRMED a DKASU name (`waka_full_name`), which is also why an existing
       * DKASU user — merchant or previously-invited staff — skips straight through. `hasTenancy` is
       * false here because acceptance is what creates the membership; that is exactly the point at
       * which the merchant flow considers someone un-provisioned.
       *
       * `reviewPrefill` seeds the fields from Google as a SUGGESTION the person can overwrite; the
       * suggested value is never written unless they submit it.
       */
      const { data: userData } = await client.auth.getUser();
      const metadata = (userData.user?.user_metadata ?? null) as Record<string, unknown> | null;
      if (needsNameReview({ kind: "merchant", hasTenancy: false, metadata })) {
        setParts(reviewPrefill(metadata));
        setPartError(null);
        setAwaitingName(true);
        setPhase("name");
        return;
      }

      setPhase("accepting");
    } catch (err) {
      // Developer diagnostics. The provider's own code/status/message is the only thing that
      // identifies WHICH gate rejected the token (`invalid nonce` for a nonce mismatch, and so
      // on); an empty report made every failure indistinguishable. Console only — never the UI,
      // never the monitoring payload. No invitation token, ID token, access token or nonce is
      // logged, because none of them is passed here.
      const code = (err as { code?: unknown } | null)?.code;
      const status = (err as { status?: unknown } | null)?.status;
      authDevLog("error", "staff invite Google sign-in failed", {
        platform,
        code: typeof code === "string" ? code : undefined,
        status: typeof status === "number" ? status : undefined,
        message: err instanceof Error ? err.message : String(err),
      });
      reportAuthIssue("invite_google_signin_error", {
        platform,
        errorCode: typeof code === "string" ? code : "unknown",
        status: typeof status === "number" ? status : 0,
      });
      setMessage(staffInviteGoogleErrorMessage(lang, err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Save the chosen DKASU name, then hand back to the acceptance effect.
   *
   * Validation and persistence are the merchant flow's own (`namePartsProblem`, `composeFullName`,
   * `confirmWakaName`) — the same three calls `StartBusinessPage` makes. Setting the phase back to
   * `"ready"` is what re-arms the accept effect above; the invitation is untouched until then.
   */
  const submitName = async () => {
    if (busy || !supabase) return;
    const problem = namePartsProblem(parts);
    if (problem) {
      setPartError({ field: problem.field, message: t(lang, problem.messageKey) });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const confirmed = await confirmWakaName({ fullName: composeFullName(parts.firstName, parts.lastName) });
      if (!confirmed.ok) {
        setMessage(t(lang, "staffInviteAcceptFailed"));
        return;
      }
      setPartError(null);
      // Releasing this is what re-arms the accept effect; the phase only drives the UI.
      setAwaitingName(false);
      setPhase("ready");
    } finally {
      setBusy(false);
    }
  };

  /** Sign the wrong account out so the invitation can be retried with the right one. */
  const switchAccount = async () => {
    if (!supabase) return;
    setBusy(true);
    try {
      await supabase.auth.signOut();
    } finally {
      setBusy(false);
      setWrongAccount(null);
      setMessage(null);
      setAwaitingName(false);
      setPartError(null);
      setPhase("ready");
      attemptRef.current = createStaffInviteAcceptAttemptController();
    }
  };

  if (phase === "success") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-waka-50 via-card to-muted px-4 py-10">
      <WakaPosLogo size="lg" className="mx-auto" />
      <p className="mt-4 text-lg font-black text-foreground">DKASU POS</p>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{WAKA_LEGAL_COMPANY_NAME}</p>

      <div className="mt-8 w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h1 className="text-lg font-black text-foreground">{t(lang, "staffInviteAcceptTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(lang, "staffInviteAcceptSub")}</p>

        {!token ? (
          <p role="alert" className="mt-4 text-sm font-semibold text-red-700">
            {t(lang, "staffInviteMissingToken")}
          </p>
        ) : initializing || phase === "accepting" ? (
          <div className="mt-6 flex flex-col items-center gap-3" role="status" aria-live="polite">
            <EnterpriseSpinner size="lg" label={t(lang, "staffInviteAccepting")} />
            <p className="text-sm font-semibold text-muted-foreground">{t(lang, "staffInviteAccepting")}</p>
          </div>
        ) : phase === "name" ? (
          /* The merchant name step, rendered by the merchant's own component. The Google email is
             deliberately not shown as an editable field — it is the verified identity. */
          <div className="mt-4 space-y-4" data-testid="staff-invite-name-step">
            <div>
              <h2 className="text-base font-black text-foreground">{t(lang, "nameReviewTitle")}</h2>
            </div>
            <NameReviewFields
              lang={lang}
              parts={parts}
              onPartsChange={setParts}
              error={partError}
              onClearError={() => setPartError(null)}
              disabled={busy}
            />
            {message ? (
              <p role="alert" className="text-sm font-semibold text-red-700">
                {message}
              </p>
            ) : null}
            <button
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void submitName()}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-waka-600 px-5 text-sm font-black text-white disabled:opacity-70"
            >
              {busy ? t(lang, "staffInviteWorking") : t(lang, "save")}
            </button>
          </div>
        ) : phase === "need_verify" ? (
          <p role="status" className="mt-4 text-sm font-semibold text-foreground">
            {t(lang, "staffInviteVerifyEmail")}
          </p>
        ) : wrongAccount ? (
          <div className="mt-4 space-y-3" role="alert">
            <p className="text-sm font-black text-amber-700">{t(lang, "staffInviteWrongAccountTitle")}</p>
            <p className="text-sm text-muted-foreground">{t(lang, "staffInviteWrongAccountBody")}</p>
            <p className="rounded-xl bg-muted px-3 py-2 text-xs font-semibold text-foreground">
              {t(lang, "staffInviteSignedInAs")}: {wrongAccount}
            </p>
            <button
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void switchAccount()}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-border bg-card px-5 text-sm font-black text-foreground disabled:opacity-70"
            >
              {busy ? t(lang, "staffInviteWorking") : t(lang, "staffInviteSwitchAccount")}
            </button>
          </div>
        ) : isAuthenticated ? (
          <p role="alert" className="mt-4 text-sm font-semibold text-red-700">
            {message ?? t(lang, "staffInviteAcceptFailed")}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">{t(lang, "staffInviteGoogleHelp")}</p>
            <button
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void signInWithGoogle()}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-black text-foreground disabled:opacity-70"
            >
              <span aria-hidden="true" className="text-base font-black text-[#4285F4]">G</span>
              {busy ? t(lang, "staffInviteWorking") : t(lang, "staffInviteContinueWithGoogle")}
            </button>
            <p className="text-xs font-medium text-muted-foreground">{t(lang, "staffInviteGooglePinNote")}</p>
            {message ? (
              <p role="alert" className="text-sm font-semibold text-red-700">
                {message}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * User-facing wording for a failed Google sign-in on this page.
 *
 * A provider rejection carries GoTrue's own wording — "Nonces mismatch", "invalid nonce" — which
 * is diagnostic, not something a cashier can act on, so it is replaced with the page's generic
 * message. Errors this page raises itself already read as plain English ("Google sign-in was
 * cancelled.") and are shown as they are. The provider's real code and message still reach the
 * console and the monitoring payload, where they are useful.
 */
export function staffInviteGoogleErrorMessage(lang: Language, err: unknown): string {
  const providerCode = (err as { code?: unknown } | null)?.code;
  if (typeof providerCode === "string" && providerCode) {
    return t(lang, "staffInviteAcceptFailed");
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return t(lang, "staffInviteAcceptFailed");
}

export function acceptErrorMessage(lang: Language, error: string): string {
  const code = error.trim().toLowerCase();
  if (code === "email_mismatch") return t(lang, "staffInviteEmailMismatch");
  if (code === "google_identity_required") return t(lang, "staffInviteGoogleRequired");
  if (code === "expired") return t(lang, "staffInviteExpired");
  if (code === "revoked" || code === "already_accepted" || code === "already_member") {
    return t(lang, "staffInviteUsed");
  }
  if (code === "invalid_token") return t(lang, "staffInviteMissingToken");
  if (code === "email_not_verified" || code.includes("email_not_verified")) {
    return t(lang, "staffInviteVerifyEmail");
  }
  if (code === "timeout" || code === "staff_link_failed") {
    return t(lang, "staffInviteAcceptFailed");
  }
  return t(lang, "staffInviteAcceptFailed");
}
