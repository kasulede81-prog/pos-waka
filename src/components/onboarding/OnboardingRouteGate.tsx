import { useMemo } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { resolveSessionActor } from "../../lib/sessionActor";
import { isShopOnboardingComplete } from "../../lib/onboardingState";
import { usePosStore } from "../../store/usePosStore";
import type { UserRole } from "../../types";

type Props = {
  authMode: "supabase" | "local";
  user: User | null;
  email: string | null | undefined;
  staffSession?: { staffId: string; staffName: string; role: UserRole } | null;
};

/** Sends new owners to /onboarding until the post-signup wizard is done. */
export function OnboardingRouteGate({ authMode, user, email, staffSession = null }: Props) {
  const location = useLocation();
  const preferences = usePosStore((s) => s.preferences);

  const actor = useMemo(
    () => resolveSessionActor({ mode: authMode, user, email, preferences, staffSession }),
    [authMode, user, email, preferences, staffSession],
  );

  if (actor.role !== "owner") return <Outlet />;

  const complete = isShopOnboardingComplete(preferences);
  const onOnboarding = location.pathname === "/onboarding";

  if (!complete && !onOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }
  if (complete && onOnboarding) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
