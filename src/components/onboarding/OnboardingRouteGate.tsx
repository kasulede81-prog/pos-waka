import { useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { bootTrace } from "../../lib/bootTrace";
import { resolveSessionActor, authOperatorRole } from "../../lib/sessionActor";
import { isShopOnboardingComplete } from "../../lib/onboardingState";
import { logOnboardingRequired } from "../../lib/firstTimeOwnerDevice";
import { fetchShopMemberRoleForUser } from "../../lib/shopMemberRole";
import { usePosStore } from "../../store/usePosStore";
import type { UserRole } from "../../types";

type Props = {
  authMode: "supabase" | "local";
  user: User | null;
  email: string | null | undefined;
  staffSession?: { staffId: string; staffName: string; role: UserRole } | null;
};

/** Sends new owners to /onboarding until the post-signup wizard is done locally. */
export function OnboardingRouteGate({ authMode, user, email, staffSession = null }: Props) {
  const location = useLocation();
  const preferences = usePosStore((s) => s.preferences);
  const [shopMemberRole, setShopMemberRole] = useState<UserRole | null>(null);

  useEffect(() => {
    if (authMode !== "supabase" || !user?.id || staffSession) {
      setShopMemberRole(null);
      return;
    }
    let cancelled = false;
    void fetchShopMemberRoleForUser(user.id).then((role) => {
      if (!cancelled) setShopMemberRole(role);
    });
    return () => {
      cancelled = true;
    };
  }, [authMode, user?.id, staffSession]);

  const actor = useMemo(
    () =>
      resolveSessionActor({
        mode: authMode,
        user,
        email,
        preferences,
        staffSession,
        shopMemberRole,
      }),
    [authMode, user, email, preferences, staffSession, shopMemberRole],
  );

  useEffect(() => {
    bootTrace("BOOT-016", "OnboardingRouteGate", "START", {
      path: location.pathname,
      complete: isShopOnboardingComplete(preferences),
      role: actor.role,
    });
    if (authMode !== "supabase" || !user?.id || authOperatorRole(actor) !== "owner") return;
    logOnboardingRequired(user.id);
    bootTrace("BOOT-016", "OnboardingRouteGate", "SUCCESS", { required: !isShopOnboardingComplete(preferences) });
  }, [authMode, user?.id, actor.role, preferences.onboardingWizardDone, preferences.onboardingDone, location.pathname, preferences, actor.role]);

  // Auth staff (shop_members non-owner) and PIN staff never enter owner onboarding.
  if (authOperatorRole(actor) !== "owner") return <Outlet />;
  if (shopMemberRole && shopMemberRole !== "owner") return <Outlet />;

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
