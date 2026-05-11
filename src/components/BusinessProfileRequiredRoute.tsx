import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { fetchOwnerOnboardingStatus } from "../lib/ownerOnboarding";

type Props = {
  authMode: "supabase" | "local";
};

export function BusinessProfileRequiredRoute({ authMode }: Props) {
  const location = useLocation();
  const [status, setStatus] = useState<{ complete: boolean } | null>(null);

  useEffect(() => {
    if (authMode !== "supabase") {
      setStatus({ complete: true });
      return;
    }
    let cancelled = false;
    setStatus(null);
    void (async () => {
      const s = await fetchOwnerOnboardingStatus();
      if (cancelled) return;
      setStatus({ complete: s?.complete ?? true });
    })();
    return () => {
      cancelled = true;
    };
  }, [authMode, location.pathname]);

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
    if (location.pathname.startsWith("/settings") || location.pathname.startsWith("/internal/")) {
      return <Outlet />;
    }
    return <Navigate to="/settings?onboard=1" replace />;
  }

  return <Outlet />;
}
