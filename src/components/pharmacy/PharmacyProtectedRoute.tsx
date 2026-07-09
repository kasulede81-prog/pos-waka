import { Navigate, useLocation } from "react-router-dom";
import { actorHasEffectivePermission } from "../../lib/actorAuthorization";
import type { Permission } from "../../types";
import { useSessionActor } from "../../context/SessionActorContext";
import { useSessionHydration } from "../../context/SessionHydrationContext";
import { useSubscription } from "../../context/SubscriptionContext";

import { isPharmacyMode } from "../../lib/pharmacy";
import { usePosStore } from "../../store/usePosStore";
import { PHARMACY_DISPENSE_ROUTE } from "../../lib/pharmacyNav";

type Props = {
  permission?: Permission;
  children: React.ReactNode;
};

function SessionLoadingGate() {
  return (
    <div className="flex min-h-[28vh] items-center justify-center px-4 text-sm font-semibold text-stone-500">
      Loading…
    </div>
  );
}

/** Pharmacy workspace guard — business type, hydration, and optional permission. */
export function PharmacyProtectedRoute({ permission, children }: Props) {
  const actor = useSessionActor();
  const location = useLocation();
  const { authMode, loading: subscriptionLoading, snapshot } = useSubscription();
  const { roleReady } = useSessionHydration();
  const preferences = usePosStore((s) => s.preferences);
  const shopHydrated = usePosStore((s) => s._hydrated);

  const waitingForSession =
    authMode === "supabase" && (subscriptionLoading || !roleReady || !shopHydrated);

  if (waitingForSession) {
    return <SessionLoadingGate />;
  }

  if (!isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled)) {
    return <Navigate to="/" replace />;
  }

  if (!actorHasEffectivePermission(actor, "pharmacy.access", snapshot, authMode)) {
    return (
      <Navigate
        to="/pharmacy/access-denied"
        replace
        state={{ from: location.pathname, reason: "pharmacy.access" }}
      />
    );
  }

  if (permission && !actorHasEffectivePermission(actor, permission, snapshot, authMode)) {
    return (
      <Navigate
        to="/pharmacy/access-denied"
        replace
        state={{ from: location.pathname, reason: permission }}
      />
    );
  }

  return <>{children}</>;
}

/** Pharmacy business-type guard only (no permission check — used for access-denied page). */
export function PharmacyBusinessRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { authMode, loading: subscriptionLoading } = useSubscription();
  const { roleReady } = useSessionHydration();
  const preferences = usePosStore((s) => s.preferences);
  const shopHydrated = usePosStore((s) => s._hydrated);

  const waitingForSession =
    authMode === "supabase" && (subscriptionLoading || !roleReady || !shopHydrated);

  if (waitingForSession) {
    return <SessionLoadingGate />;
  }

  if (!isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled)) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

export function PharmacyPosRedirect({ children }: { children: React.ReactNode }) {
  const preferences = usePosStore((s) => s.preferences);
  if (isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled)) {
    return <Navigate to={PHARMACY_DISPENSE_ROUTE} replace />;
  }
  return <>{children}</>;
}
