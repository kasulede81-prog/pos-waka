import { useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { resolveSessionActor } from "../../lib/sessionActor";
import { isShopOnboardingComplete } from "../../lib/onboardingState";
import {
  fetchOwnerOnboardingStatus,
  readCachedOwnerOnboardingComplete,
} from "../../lib/ownerOnboarding";
import { usePosStore } from "../../store/usePosStore";
import type { UserRole } from "../../types";

type Props = {
  authMode: "supabase" | "local";
  user: User | null;
  email: string | null | undefined;
  staffSession?: { staffId: string; staffName: string; role: UserRole } | null;
};

function ownerAlreadyProvisioned(userId: string | undefined, authMode: "supabase" | "local"): boolean {
  if (!userId || authMode !== "supabase") return false;
  const cached = readCachedOwnerOnboardingComplete(userId);
  return cached === true;
}

/** Sends new owners to /onboarding until the post-signup wizard is done. */
export function OnboardingRouteGate({ authMode, user, email, staffSession = null }: Props) {
  const location = useLocation();
  const preferences = usePosStore((s) => s.preferences);
  const [serverComplete, setServerComplete] = useState<boolean | null>(() =>
    ownerAlreadyProvisioned(user?.id, authMode) ? true : null,
  );

  const actor = useMemo(
    () => resolveSessionActor({ mode: authMode, user, email, preferences, staffSession }),
    [authMode, user, email, preferences, staffSession],
  );

  useEffect(() => {
    if (authMode !== "supabase" || !user?.id || actor.role !== "owner") return;
    if (ownerAlreadyProvisioned(user.id, authMode)) {
      setServerComplete(true);
      return;
    }
    let cancelled = false;
    void fetchOwnerOnboardingStatus().then((s) => {
      if (cancelled) return;
      setServerComplete(s?.complete ?? false);
    });
    return () => {
      cancelled = true;
    };
  }, [authMode, user?.id, actor.role]);

  if (actor.role !== "owner") return <Outlet />;

  const complete =
    isShopOnboardingComplete(preferences) || serverComplete === true;
  const onOnboarding = location.pathname === "/onboarding";

  if (!complete && !onOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }
  if (complete && onOnboarding) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
