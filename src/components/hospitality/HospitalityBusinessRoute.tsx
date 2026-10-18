import { Navigate, useLocation } from "react-router-dom";
import { useSessionHydration } from "../../context/SessionHydrationContext";
import { useSubscription } from "../../context/SubscriptionContext";
import { isHospitalityMode } from "../../lib/hospitality";
import { usePosStore } from "../../store/usePosStore";

type Props = {
  children: React.ReactNode;
};

function SessionLoadingGate() {
  return (
    <div className="flex min-h-[28vh] items-center justify-center px-4 text-sm font-semibold text-muted-foreground">
      Loading…
    </div>
  );
}

/**
 * Hospitality business-type guard only.
 *
 * Permissions remain the job of the existing RoleProtectedRoute. This guard
 * answers one question — is this shop a Hospitality shop? — before a Hospitality
 * page mounts. It must stay outside any page that calls ensureHospitalityFloor(),
 * because those pages seed/repair floor data as a mount side effect; a retail shop
 * opening /floor, /floor/reservations or /settings/floor must not create it.
 */
export function HospitalityBusinessRoute({ children }: Props) {
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

  if (!isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
