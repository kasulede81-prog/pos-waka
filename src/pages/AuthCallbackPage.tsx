import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { authDevLog } from "../lib/authConfig";
import { publishAuthSessionFromCallback } from "../lib/authSessionBridge";
import { bootTrace, bootTraceAsync } from "../lib/bootTrace";
import { hardSignOutToLogin } from "../lib/authRecovery";
import { bootstrapAuthCallbackSession } from "../lib/authCallbackSession";
import {
  markFirstTimeOwnerOnDevice,
  resolvePostAuthDestination,
} from "../lib/firstTimeOwnerDevice";
import { ensureOwnerWorkspaceIfNeeded } from "../lib/ownerWorkspaceOnSignIn";
import { resetCloudRecoverySessionForRetry } from "../lib/cloudRecoverySession";
import { logStartupPhase } from "../lib/startupDiagnostics";
import { supabase } from "../lib/supabase";
import { tryOpenInstalledAppFromBrowserCallback } from "../lib/nativeAuthDeepLink";
import { withTimeout } from "../lib/promiseTimeout";
import { WAKA_LEGAL_COMPANY_NAME } from "../config/wakaSupport";

type CallbackState = "loading" | "success" | "error";

const CALLBACK_RUN_TIMEOUT_MS = 20_000;

function postCallbackDestination(userId: string): string {
  return resolvePostAuthDestination(userId);
}

/**
 * OAuth / email confirmation return URL.
 * Add `https://pos.waka.ug/auth/callback` to Supabase Auth → Redirect URLs.
 */
export function AuthCallbackPage() {
  const [state, setState] = useState<CallbackState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [destination, setDestination] = useState("/onboarding");
  const [signingOut, setSigningOut] = useState(false);
  const handled = useRef(false);
  const finishedRef = useRef(false);

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

        try {
          await bootTraceAsync("BOOT-008", "bootstrap_owner_workspace", () =>
            withTimeout(ensureOwnerWorkspaceIfNeeded(session), 12_000, undefined),
          );
          logStartupPhase("workspace_ready", { userId: session.user.id });
        } catch (e) {
          authDevLog("error", "Auth callback workspace bootstrap deferred", e);
          logStartupPhase("workspace_ready", {
            userId: session.user.id,
            deferred: true,
            error: e instanceof Error ? e.message : String(e),
          });
        }

        markFirstTimeOwnerOnDevice(session.user.id);

        const nextPath = postCallbackDestination(session.user.id);
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

  if (state === "success") return <Navigate to={destination} replace />;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-waka-50 via-card to-muted px-4 py-10">
      <WakaPosLogo size="lg" className="mx-auto" />
      <p className="mt-4 text-lg font-black text-foreground">Waka POS</p>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{WAKA_LEGAL_COMPANY_NAME}</p>

      {state === "loading" ? (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <span
            className="h-10 w-10 animate-spin rounded-full border-[3px] border-waka-200 border-t-orange-600"
            aria-hidden
          />
          <p className="text-sm font-semibold text-muted-foreground">Finishing sign-in…</p>
          <p className="max-w-xs text-xs text-muted-foreground">Please wait while we secure your session.</p>
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
