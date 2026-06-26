import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { authDevLog } from "../lib/authConfig";
import { hardSignOutToLogin } from "../lib/authRecovery";
import { bootstrapAuthCallbackSession } from "../lib/authCallbackSession";
import { ensureOwnerWorkspaceIfNeeded } from "../lib/ownerWorkspaceOnSignIn";
import { fetchOwnerOnboardingStatus, readCachedOwnerOnboardingComplete } from "../lib/ownerOnboarding";
import { resetCloudRecoverySessionForRetry } from "../lib/cloudRecoverySession";
import { supabase } from "../lib/supabase";
import { tryOpenInstalledAppFromBrowserCallback } from "../lib/nativeAuthDeepLink";
import { WAKA_LEGAL_COMPANY_NAME } from "../config/wakaSupport";

type CallbackState = "loading" | "success" | "error";

async function postCallbackDestination(userId: string): Promise<string> {
  try {
    const status = await fetchOwnerOnboardingStatus();
    if (status?.complete) return "/";
  } catch {
    /* onboarding check is best-effort */
  }
  if (readCachedOwnerOnboardingComplete(userId) === true) return "/";
  return "/onboarding";
}

/**
 * OAuth / email confirmation return URL.
 * Add `https://pos.waka.ug/auth/callback` to Supabase Auth → Redirect URLs.
 */
export function AuthCallbackPage() {
  const [state, setState] = useState<CallbackState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [destination, setDestination] = useState("/");
  const [signingOut, setSigningOut] = useState(false);
  const handled = useRef(false);

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
      if (!cancelled) {
        setErrorMessage(msg);
        setState("error");
      }
    };

    const run = async () => {
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
        await ensureOwnerWorkspaceIfNeeded(session);
      } catch (e) {
        authDevLog("error", "Auth callback workspace bootstrap deferred", e);
        // Session is valid — shell bootstrap will retry; still send user to onboarding.
      }

      const nextPath = await postCallbackDestination(session.user.id);
      resetCloudRecoverySessionForRetry();
      if (!cancelled) {
        setDestination(nextPath);
        setState("success");
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleBackToLogin = () => {
    setSigningOut(true);
    void hardSignOutToLogin();
  };

  if (state === "success") return <Navigate to={destination} replace />;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-orange-50 via-white to-stone-50 px-4 py-10">
      <WakaPosLogo size="lg" className="mx-auto" />
      <p className="mt-4 text-lg font-black text-stone-900">Waka POS</p>
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{WAKA_LEGAL_COMPANY_NAME}</p>

      {state === "loading" ? (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <span
            className="h-10 w-10 animate-spin rounded-full border-[3px] border-orange-200 border-t-orange-600"
            aria-hidden
          />
          <p className="text-sm font-semibold text-stone-700">Finishing sign-in…</p>
          <p className="max-w-xs text-xs text-stone-500">Please wait while we secure your session.</p>
        </div>
      ) : null}

      {state === "error" ? (
        <div className="mt-8 max-w-sm rounded-2xl border border-red-100 bg-white p-5 text-center shadow-sm">
          <p className="text-sm font-bold text-red-700">Could not complete sign-in</p>
          <p className="mt-2 text-sm text-stone-600">{errorMessage ?? "Unknown error"}</p>
          <button
            type="button"
            disabled={signingOut}
            onClick={handleBackToLogin}
            className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-orange-600 px-5 text-sm font-black text-white disabled:opacity-70"
          >
            {signingOut ? "Signing out…" : "Back to sign in"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
