import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { authDevLog, formatAuthError, parseOAuthCallbackError } from "../lib/authConfig";
import { supabase } from "../lib/supabase";
import { WAKA_LEGAL_COMPANY_NAME } from "../config/wakaSupport";

type CallbackState = "loading" | "success" | "error";

/**
 * OAuth / email confirmation return URL.
 * Add `https://pos.waka.ug/auth/callback` to Supabase Auth → Redirect URLs.
 */
export function AuthCallbackPage() {
  const [state, setState] = useState<CallbackState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    const sb = supabase;
    if (!sb) {
      setState("error");
      setErrorMessage("Cloud sign-in is not configured.");
      return undefined;
    }

    if (handled.current) return undefined;
    handled.current = true;

    const urlError = parseOAuthCallbackError();
    if (urlError) {
      authDevLog("error", "OAuth callback URL error", urlError);
      setErrorMessage(urlError);
      setState("error");
      return undefined;
    }

    let cancelled = false;

    const finishSuccess = () => {
      if (!cancelled) setState("success");
    };

    const finishError = (msg: string) => {
      if (!cancelled) {
        setErrorMessage(msg);
        setState("error");
      }
    };

    const { data: listener } = sb.auth.onAuthStateChange((event, session) => {
      authDevLog("log", "Auth callback state", { event, hasSession: Boolean(session) });
      if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")) {
        finishSuccess();
      }
    });

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (code) {
        const { error } = await sb.auth.exchangeCodeForSession(code);
        if (error) {
          authDevLog("error", "exchangeCodeForSession failed", error);
          finishError(formatAuthError(error));
          return;
        }
        finishSuccess();
        return;
      }

      const { data, error } = await sb.auth.getSession();
      if (error) {
        authDevLog("error", "getSession on callback failed", error);
        finishError(formatAuthError(error));
        return;
      }
      if (data.session) {
        finishSuccess();
        return;
      }

      window.setTimeout(async () => {
        const retry = await sb.auth.getSession();
        if (retry.data.session) finishSuccess();
        else finishError("Sign-in timed out. Please try again from the login page.");
      }, 4500);
    };

    void run();

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (state === "success") return <Navigate to="/" replace />;

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
          <Link
            to="/login"
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-orange-600 px-5 text-sm font-black text-white"
          >
            Back to sign in
          </Link>
        </div>
      ) : null}
    </div>
  );
}
