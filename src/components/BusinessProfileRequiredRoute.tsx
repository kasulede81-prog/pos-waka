import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { EnterpriseSpinner } from "./enterprise/EnterpriseSpinner";
import { onboardingGateDecision } from "../lib/merchantRegistration";
import {
  fetchOwnerOnboardingStatus,
  readCachedOwnerOnboardingComplete,
  writeCachedOwnerOnboardingComplete,
} from "../lib/ownerOnboarding";

type Props = {
  authMode: "supabase" | "local";
  userId?: string | null;
};

/** While Supabase says business profile is incomplete, still allow core POS routes so the app is not trapped on Settings. */
function pathAllowedBeforeBusinessProfileComplete(pathname: string): boolean {
  const p = pathname || "/";
  if (p === "/" || p === "") return true;
  if (p.startsWith("/settings")) return true;
  if (p.startsWith("/internal/")) return true;
  if (p === "/onboarding" || p.startsWith("/onboarding/")) return true;
  if (p === "/pos" || p.startsWith("/pos/")) return true;
  if (p === "/receipts" || p.startsWith("/receipts/")) return true;
  if (p === "/upgrade" || p.startsWith("/upgrade/")) return true;
  if (p === "/customers" || p.startsWith("/customers/")) return true;
  if (p === "/debts" || p.startsWith("/debts/")) return true;
  return false;
}

/**
 * Business-profile gate.
 *
 * THE SERVER DECIDES. `owner_onboarding_status()` is the authority on whether a shop has finished
 * setup; the cached flag is a hint that may be shown while the answer is on its way, but it can
 * never stand in for it. The previous version read `s?.complete ?? true`, which turned "the
 * status RPC failed" into "this merchant is fully onboarded" — so a database hiccup silently
 * dropped the business-profile requirement for everyone, for as long as it lasted.
 *
 * FAIL CLOSED, WITH A WAY OUT. When the state cannot be determined the merchant is neither
 * admitted nor bounced to `/settings?onboard=1` (which would be a lie about why). They get a
 * retry, and the check re-runs on focus and on `waka:onboarding-updated`.
 */
export function BusinessProfileRequiredRoute({ authMode, userId }: Props) {
  const location = useLocation();
  const [status, setStatus] = useState<
    { kind: "checking" } | { kind: "complete" } | { kind: "incomplete" } | { kind: "unavailable" }
  >(() => {
    if (authMode !== "supabase") return { kind: "complete" };
    // The cached answer is a per-TAB memory of what the server said earlier in this same session,
    // so it may spare the merchant a spinner — but it is only ever a first paint. The check below
    // still runs, the server's answer still replaces it, and a FAILED check resolves to
    // `unavailable` rather than to this value.
    return readCachedOwnerOnboardingComplete(userId ?? undefined) === true
      ? { kind: "complete" }
      : { kind: "checking" };
  });
  const [retrying, setRetrying] = useState(false);
  const cancelledRef = useRef(false);

  const check = useCallback(async () => {
    const s = await fetchOwnerOnboardingStatus();
    if (cancelledRef.current) return;
    // `null` is "could not find out" and resolves to `unavailable`, never to `complete`.
    if (s && userId) writeCachedOwnerOnboardingComplete(userId, s.complete);
    setStatus({ kind: onboardingGateDecision(s) });
  }, [userId]);

  // Only depend on auth mode / user — not on every pathname. Including pathname caused
  // status to reset to null on each navigation so the whole app (including Back Office)
  // showed "Loading…" and felt frozen while onboarding RPC re-ran.
  useEffect(() => {
    cancelledRef.current = false;
    if (authMode !== "supabase") return;
    void check();
    return () => {
      cancelledRef.current = true;
    };
  }, [authMode, userId, check]);

  useEffect(() => {
    if (authMode !== "supabase") return;
    const fn = () => {
      void check();
    };
    window.addEventListener("waka:onboarding-updated", fn);
    return () => window.removeEventListener("waka:onboarding-updated", fn);
  }, [authMode, check]);

  // Local mode has no cloud authority to consult, and never had one to fail against.
  if (authMode !== "supabase") return <Outlet />;

  if (status.kind === "checking") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <EnterpriseSpinner />
      </div>
    );
  }

  if (status.kind === "unavailable") {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-5">
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <p className="text-base font-black text-foreground">We can’t check your shop setup</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Waka could not confirm whether your business profile is complete. Nothing has been
            changed. Check your connection and try again.
          </p>
          <button
            type="button"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              setStatus({ kind: "checking" });
              void check().finally(() => setRetrying(false));
            }}
            className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-waka-600 px-5 text-sm font-black text-white disabled:opacity-50"
          >
            {retrying ? "Checking…" : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  if (status.kind === "incomplete") {
    if (pathAllowedBeforeBusinessProfileComplete(location.pathname)) {
      return <Outlet />;
    }
    return <Navigate to="/settings?onboard=1" replace />;
  }

  return <Outlet />;
}
