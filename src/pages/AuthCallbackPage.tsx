import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { EnterpriseSpinner } from "../components/enterprise/EnterpriseSpinner";
import { authDevLog } from "../lib/authConfig";
import { publishAuthSessionFromCallback } from "../lib/authSessionBridge";
import { bootTrace, bootTraceAsync } from "../lib/bootTrace";
import { hardSignOutToLogin } from "../lib/authRecovery";
import { bootstrapAuthCallbackSession } from "../lib/authCallbackSession";
import { markFirstTimeOwnerOnDevice } from "../lib/firstTimeOwnerDevice";
import {
  destinationFor,
  PROVISION_FAILED_MESSAGE,
  provisionOwnerWorkspace,
} from "../lib/ownerProvisioning";
import { resolveStaffInviteBeforeOwnerBootstrap } from "../lib/staffInviteOnboarding";
import { peekStaffInviteToken } from "../lib/staffInvite";
import { hasStaffLoginIntent } from "../lib/staffLogin";
import { memberIntentFromMetadata, resolveAccountIdentity } from "../lib/memberIdentity";
import { isLoyaltySurface } from "../lib/productHost";
import { consumePendingProgramPath } from "../lib/pendingLoyaltyProgram";
import { markMemberWorkspace } from "../lib/workspaceBootstrapCache";
import { resetCloudRecoverySessionForRetry } from "../lib/cloudRecoverySession";
import { logStartupPhase } from "../lib/startupDiagnostics";
import { supabase } from "../lib/supabase";
import { tryOpenInstalledAppFromBrowserCallback } from "../lib/nativeAuthDeepLink";
import { WAKA_LEGAL_COMPANY_NAME } from "../config/wakaSupport";

type CallbackState = "loading" | "success" | "error" | "provisioning_failed";

const CALLBACK_RUN_TIMEOUT_MS = 20_000;


/**
 * OAuth / email confirmation return URL.
 * Add `https://pos.waka.ug/auth/callback` to Supabase Auth → Redirect URLs.
 */
export function AuthCallbackPage() {
  const [state, setState] = useState<CallbackState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [destination, setDestination] = useState("/onboarding");
  const [signingOut, setSigningOut] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const handled = useRef(false);
  const finishedRef = useRef(false);
  /**
   * Everything a retry needs, captured when the first attempt ran. The bootstrap is idempotent,
   * so retrying is safe: a second call finds the first call's organization and shop and changes
   * nothing, which is exactly why this may be offered as a plain "try again".
   */
  const retryContextRef = useRef<{
    session: Session;
    pendingJoinPath: string | null;
    landing: string;
    memberOnly: boolean;
    skipOwnerBootstrap: boolean;
    inviteAccepted: boolean;
  } | null>(null);

  useEffect(() => {
    tryOpenInstalledAppFromBrowserCallback();
  }, []);

  useEffect(() => {
    const sb = supabase;
    if (!sb) {
      setState("error");
      setErrorMessage("Cloud sign-in is not configured.");
      return undefined;
    }

    if (handled.current) return undefined;
    handled.current = true;

    let cancelled = false;

    const finishError = (msg: string) => {
      finishedRef.current = true;
      if (!cancelled) {
        setErrorMessage(msg);
        setState("error");
      }
    };

    const run = async () => {
      bootTrace("BOOT-002", "AuthCallback entered", "START");
      try {
        const result = await bootstrapAuthCallbackSession();
        if (cancelled) return;

        if (result.status !== "ready") {
          finishError(result.message ?? "Could not complete sign-in.");
          return;
        }

        let session = result.session ?? null;
        if (!session) {
          const { data } = await sb.auth.getSession();
          session = data.session ?? null;
        }
        if (!session) {
          finishError("Sign-in timed out. Please try again from the login page.");
          return;
        }

        logStartupPhase("auth_restored", {
          userId: session.user.id,
          emailConfirmed: Boolean(session.user.email_confirmed_at),
        });
        bootTrace("BOOT-006", "Session restored", "SUCCESS", {
          userId: session.user.id,
          emailConfirmed: Boolean(session.user.email_confirmed_at),
        });

        publishAuthSessionFromCallback(session);

        try {
          await sb.auth.refreshSession();
        } catch {
          /* ignore */
        }

        authDevLog("log", "Auth callback session ready", {
          userId: session.user.id,
          emailConfirmed: Boolean(session.user.email_confirmed_at),
        });

        // Phase 2 — a staff Google sign-in on the native shell leaves the WebView and comes back
        // through the deep link as a FULL PAGE RELOAD, so this page runs before LoginPage and
        // cannot tell a staff sign-in from a merchant one on its own: the marker the staff button
        // wrote is the only evidence. A staff sign-in must not be sent down the owner destination,
        // so hand control back to /login, which owns the staff gate — shop resolution, the picker
        // and the no-access message. The marker is deliberately left in place for the gate to seed
        // from; it clears itself once the gate settles.
        //
        // Checked AFTER the invitation case: a pending invitation token means the invitation flow
        // owns this return (Phase 1), and that must not be diverted into the ordinary staff gate.
        if (hasStaffLoginIntent() && !peekStaffInviteToken()) {
          logStartupPhase("workspace_ready", { userId: session.user.id, via: "staff_login_intent" });
          bootTrace("BOOT-010", "navigate", "SUCCESS", {
            destination: "/login",
            via: "staff_login_intent",
          });
          if (!cancelled) {
            finishedRef.current = true;
            setDestination("/login");
            setState("success");
          }
          return;
        }

        const inviteGate = await resolveStaffInviteBeforeOwnerBootstrap(session);

        // Phase 1 — classify here as well. This page bootstraps INDEPENDENTLY of
        // ensureWorkspaceForSession (it calls ensureOwnerWorkspaceIfNeeded directly), so a member
        // gated only inside useAuth would still receive a shop the moment they confirm their
        // email. `memberOnly` covers both the member and the unclassified case: neither may be
        // provisioned a tenancy.
        const accountIdentity = await resolveAccountIdentity({
          userId: session.user.id,
          metadata: session.user.user_metadata as Record<string, unknown> | undefined,
        });
        const memberOnly = accountIdentity.kind !== "merchant";
        // `unknown` and `member` both skip provisioning, but they are different people: a member
        // goes to their member home, an unclassified session gets the choice page.
        //
        // Phase 2B — a member-intent signup that has not registered yet also lands on /member.
        // At that point it classifies as `unknown` (member intent without a `loyalty_members` row),
        // so it would otherwise be sent to /welcome and have to find its own way back. Only the
        // DESTINATION changes here: `memberOnly` above is untouched, so the bootstrap is still
        // skipped exactly as before, and a real merchant never reaches this line at all because a
        // tenancy classifies as `merchant` and takes the `postCallbackDestination` branch.
        // Phase 2C — on loyalty.waka.ug a brand-new session has NO metadata to read (a Google
        // identity carries none of ours), so intent comes from the host it returned to. It is sent
        // to the member surface, where the existing registration form completes it; the merchant
        // /welcome chooser is a POS surface and is not part of the customer app.
        //
        // This changes the DESTINATION only. `memberOnly` above is untouched, so a loyalty-host
        // session still provisions nothing — reaching /member is not membership, and the member row
        // is only ever created by the explicit registration form.
        // Phase 2C — a customer who opened /j/WPL2026001 and then signed in with Google left that
        // page for the account chooser. `consumePendingProgramPath()` hands back where they were,
        // and consuming it here (one shot) means it cannot influence a later sign-in.
        //
        // ONLY THE CODE IS RESTORED. The destination is a plain /j/<code> URL, which re-renders and
        // re-resolves everything server-side; no shop, account, member or organization id is read
        // from storage, and none is ever written there. Gated on the loyalty surface so a POS
        // session can never consume a customer join.
        //
        // Deliberately consulted BEFORE the member/`unknown` landing: a pending join is a more
        // specific destination than "somewhere in the customer app", and for a brand-new Google
        // user it is the difference between joining the merchant they scanned and landing on a
        // registration form with no context.
        const pendingJoinPath = isLoyaltySurface() ? consumePendingProgramPath() : null;

        const landing = pendingJoinPath
          ? pendingJoinPath
          : accountIdentity.kind === "member" ||
              memberIntentFromMetadata(session.user.user_metadata as Record<string, unknown> | undefined) ||
              isLoyaltySurface()
            ? "/member"
            : "/welcome";
        if (accountIdentity.kind === "member") markMemberWorkspace(session.user.id);

        // Captured BEFORE the gate below, so that the gate's body still begins with the
        // bootstrap itself: the condition that decides whether a workspace is provisioned must
        // stay exactly `!inviteGate.skipOwnerBootstrap && !memberOnly`, with nothing added to it
        // — including anything from the pending-join path. The retry only ever reads this, and
        // a session that skips provisioning never reaches the screen that offers it.
        retryContextRef.current = {
          session,
          pendingJoinPath,
          landing,
          memberOnly,
          skipOwnerBootstrap: inviteGate.skipOwnerBootstrap,
          inviteAccepted: inviteGate.accepted,
        };

        // Provisioning is a PRECONDITION, not a best effort. A merchant whose workspace could
        // not be created must not be walked into the app with a shop that does not exist — the
        // failure is shown, with a retry, and nothing is marked as done.
        if (!inviteGate.skipOwnerBootstrap && !memberOnly) {
          const outcome = await bootTraceAsync("BOOT-008", "bootstrap_owner_workspace", () =>
            provisionOwnerWorkspace(session),
          );
          if (!outcome.ok) {
            authDevLog("error", "Auth callback workspace bootstrap failed", outcome.message);
            logStartupPhase("workspace_ready", {
              userId: session.user.id,
              deferred: false,
              failed: true,
            });
            if (!cancelled) {
              finishedRef.current = true;
              setErrorMessage(outcome.message);
              setState("provisioning_failed");
            }
            return;
          }
          markFirstTimeOwnerOnDevice(session.user.id);
        }

        logStartupPhase("workspace_ready", {
          userId: session.user.id,
          via: inviteGate.skipOwnerBootstrap
            ? "staff_invite_gate"
            : memberOnly
              ? "loyalty_member"
              : "owner_bootstrap",
        });

        // A pending Loyalty join wins over every other destination, because it is the most
        // specific thing we know about why this person signed in — but it changes the DESTINATION
        // only. `memberOnly` and `inviteGate` have already decided, above, whether a tenancy may be
        // provisioned, and that decision is untouched by anything here.
        const nextPath = await destinationFor({
          userId: session.user.id,
          pendingJoinPath,
          skipOwnerBootstrap: inviteGate.skipOwnerBootstrap,
          inviteAccepted: inviteGate.accepted,
          memberOnly,
          landing,
        });
        resetCloudRecoverySessionForRetry();
        logStartupPhase("onboarding_required", {
          userId: session.user.id,
          required: nextPath === "/onboarding",
          destination: nextPath,
        });
        bootTrace("BOOT-010", "navigate", "SUCCESS", { destination: nextPath });

        if (!cancelled) {
          finishedRef.current = true;
          setDestination(nextPath);
          setState("success");
          bootTrace("BOOT-002", "AuthCallback entered", "SUCCESS", { destination: nextPath });
        }
      } catch (e) {
        bootTrace("BOOT-002", "AuthCallback entered", "FAILED", {
          error: e instanceof Error ? e.message : String(e),
        });
        finishError(e instanceof Error ? e.message : "Could not complete sign-in.");
      }
    };

    const timeoutId = window.setTimeout(() => {
      if (!cancelled && !finishedRef.current) {
        bootTrace("BOOT-002", "AuthCallback entered", "TIMEOUT", { timeoutMs: CALLBACK_RUN_TIMEOUT_MS });
        finishError("Sign-in took too long. Please try again from the login page.");
      }
    }, CALLBACK_RUN_TIMEOUT_MS);

    void run().finally(() => {
      window.clearTimeout(timeoutId);
    });

    return () => {
      cancelled = true;
      // React StrictMode re-runs effects in dev; allow the second pass to complete sign-in.
      if (!finishedRef.current) handled.current = false;
    };
  }, []);

  const handleBackToLogin = () => {
    setSigningOut(true);
    void hardSignOutToLogin();
  };

  /**
   * Retry the provisioning that failed. The session is already established, so this does not
   * re-run the OAuth exchange — it re-runs the one idempotent step that did not finish, and only
   * navigates once that step has actually succeeded.
   */
  const handleRetryProvisioning = () => {
    const ctx = retryContextRef.current;
    if (!ctx) {
      handleBackToLogin();
      return;
    }
    setRetrying(true);
    setErrorMessage(null);
    void (async () => {
      const outcome = await provisionOwnerWorkspace(ctx.session);
      if (!outcome.ok) {
        setRetrying(false);
        setErrorMessage(outcome.message);
        return;
      }
      markFirstTimeOwnerOnDevice(ctx.session.user.id);
      const nextPath = await destinationFor({
        userId: ctx.session.user.id,
        pendingJoinPath: ctx.pendingJoinPath,
        skipOwnerBootstrap: ctx.skipOwnerBootstrap,
        inviteAccepted: ctx.inviteAccepted,
        memberOnly: ctx.memberOnly,
        landing: ctx.landing,
      });
      logStartupPhase("workspace_ready", { userId: ctx.session.user.id, via: "callback_retry" });
      resetCloudRecoverySessionForRetry();
      setRetrying(false);
      setDestination(nextPath);
      setState("success");
    })();
  };

  if (state === "success") return <Navigate to={destination} replace />;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-waka-50 via-card to-muted px-4 py-10">
      <WakaPosLogo size="lg" className="mx-auto" />
      <p className="mt-4 text-lg font-black text-foreground">DKASU POS</p>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{WAKA_LEGAL_COMPANY_NAME}</p>

      {state === "loading" ? (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <EnterpriseSpinner size="lg" label="Finishing sign-in" />
          <p className="text-sm font-semibold text-muted-foreground">Finishing sign-in…</p>
          <p className="max-w-xs text-xs text-muted-foreground">Please wait while we secure your session.</p>
        </div>
      ) : null}

      {state === "provisioning_failed" ? (
        <div className="mt-8 max-w-sm rounded-2xl border border-amber-200 bg-card p-5 text-center shadow-sm">
          <p className="text-sm font-bold text-foreground">Your shop is not set up yet</p>
          <p className="mt-2 text-sm text-muted-foreground">{errorMessage ?? PROVISION_FAILED_MESSAGE}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Your account is safe and nothing was created twice. Trying again continues from where
            it stopped.
          </p>
          <button
            type="button"
            disabled={retrying}
            onClick={handleRetryProvisioning}
            className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-waka-600 px-5 text-sm font-black text-white disabled:opacity-70"
          >
            {retrying ? "Setting up your shop…" : "Try again"}
          </button>
          <button
            type="button"
            disabled={signingOut}
            onClick={handleBackToLogin}
            className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-border px-5 text-sm font-black text-foreground disabled:opacity-70"
          >
            {signingOut ? "Signing out…" : "Back to sign in"}
          </button>
        </div>
      ) : null}

      {state === "error" ? (
        <div className="mt-8 max-w-sm rounded-2xl border border-red-100 bg-card p-5 text-center shadow-sm">
          <p className="text-sm font-bold text-red-700">Could not complete sign-in</p>
          <p className="mt-2 text-sm text-muted-foreground">{errorMessage ?? "Unknown error"}</p>
          <button
            type="button"
            disabled={signingOut}
            onClick={handleBackToLogin}
            className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-waka-600 px-5 text-sm font-black text-white disabled:opacity-70"
          >
            {signingOut ? "Signing out…" : "Back to sign in"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
