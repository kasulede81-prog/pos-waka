import { useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { bootTrace } from "../../lib/bootTrace";
import { resolveSessionActor, authOperatorRole } from "../../lib/sessionActor";
import { isShopOnboardingComplete } from "../../lib/onboardingState";
import { logOnboardingRequired } from "../../lib/firstTimeOwnerDevice";
import { fetchOwnerOnboardingStatus } from "../../lib/ownerOnboarding";
import { fetchShopMemberRoleForUser } from "../../lib/shopMemberRole";
import { usePosStore } from "../../store/usePosStore";
import type { UserRole } from "../../types";

type Props = {
  authMode: "supabase" | "local";
  user: User | null;
  email: string | null | undefined;
  staffSession?: { staffId: string; staffName: string; role: UserRole } | null;
};

/**
 * Sends new owners to /onboarding until the post-signup wizard is done.
 *
 * THE SERVER SETTLES IT. Local preferences are the fast path and the first paint, but they are a
 * device's memory, not the truth: a returning owner on a new phone has none of them, and a
 * device that recorded completion while the cloud save was refused has a flag the server does not
 * agree with. So when the local answer says "not complete" the cloud is asked once, and its answer
 * wins — which both stops a returning merchant being marched through the wizard again and stops a
 * half-finished merchant being waved through to the POS.
 *
 * When the cloud cannot be reached the local answer stands. This gate decides which screen to
 * show, not what a merchant may do; the business-profile gate is the one that fails closed, and
 * provisioning is unaffected either way.
 */
export function OnboardingRouteGate({ authMode, user, email, staffSession = null }: Props) {
  const location = useLocation();
  const preferences = usePosStore((s) => s.preferences);
  const [shopMemberRole, setShopMemberRole] = useState<UserRole | null>(null);
  /** Keyed by user id so one account's answer can never stand in for another's. */
  const [cloudStatus, setCloudStatus] = useState<{ uid: string; complete: boolean | null } | null>(null);
  const cloudComplete = cloudStatus && cloudStatus.uid === user?.id ? cloudStatus.complete : null;

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

  // Ask the authority, but only when the device does not already know the answer is "yes".
  useEffect(() => {
    const uid = user?.id;
    if (authMode !== "supabase" || !uid) return;
    let cancelled = false;
    const ask = () => {
      if (isShopOnboardingComplete(usePosStore.getState().preferences)) return;
      void fetchOwnerOnboardingStatus().then((s) => {
        if (!cancelled) setCloudStatus({ uid, complete: s?.complete ?? null });
      });
    };
    ask();
    window.addEventListener("waka:onboarding-updated", ask);
    return () => {
      cancelled = true;
      window.removeEventListener("waka:onboarding-updated", ask);
    };
  }, [authMode, user?.id]);

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

  // Local first, then the server's answer — never the other way round, and never local alone
  // when the server says the wizard IS finished (that is the returning-owner-on-a-new-device case).
  const complete = isShopOnboardingComplete(preferences) || cloudComplete === true;
  const onOnboarding = location.pathname === "/onboarding";

  if (!complete && !onOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }
  if (complete && onOnboarding) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
