import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
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

export function BusinessProfileRequiredRoute({ authMode, userId }: Props) {
  const location = useLocation();
  const [status, setStatus] = useState<{ complete: boolean } | null>(() => {
    if (authMode !== "supabase") return { complete: true };
    const cached = readCachedOwnerOnboardingComplete(userId ?? undefined);
    if (cached !== null) return { complete: cached };
    return null;
  });

  // Only depend on auth mode / user — not on every pathname. Including pathname caused
  // status to reset to null on each navigation so the whole app (including Back Office)
  // showed "Loading…" and felt frozen while onboarding RPC re-ran.
  useEffect(() => {
    if (authMode !== "supabase") {
      setStatus({ complete: true });
      return;
    }
    let cancelled = false;
    const slow = window.setTimeout(() => {
      if (cancelled) return;
      setStatus((prev) => {
        if (prev !== null) return prev;
        console.warn("[waka] owner_onboarding_status: slow response — unblocking shell (will apply result when ready)");
        return { complete: true };
      });
    }, 2_500);

    void fetchOwnerOnboardingStatus().then((s) => {
      if (cancelled) return;
      window.clearTimeout(slow);
      const complete = s?.complete ?? true;
      if (userId) writeCachedOwnerOnboardingComplete(userId, complete);
      setStatus({ complete });
    });

    return () => {
      cancelled = true;
      window.clearTimeout(slow);
    };
  }, [authMode, userId]);

  useEffect(() => {
    if (authMode !== "supabase") return;
    const fn = () => {
      void fetchOwnerOnboardingStatus().then((s) => setStatus({ complete: s?.complete ?? true }));
    };
    window.addEventListener("waka:onboarding-updated", fn);
    return () => window.removeEventListener("waka:onboarding-updated", fn);
  }, [authMode]);

  if (authMode !== "supabase") return <Outlet />;

  if (status === null) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center bg-slate-50 text-sm font-semibold text-slate-600">
        Loading…
      </div>
    );
  }

  if (!status.complete) {
    if (pathAllowedBeforeBusinessProfileComplete(location.pathname)) {
      return <Outlet />;
    }
    return <Navigate to="/settings?onboard=1" replace />;
  }

  return <Outlet />;
}
