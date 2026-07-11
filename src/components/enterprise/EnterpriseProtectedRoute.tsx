import { Navigate, useLocation } from "react-router-dom";
import { actorHasEffectivePermission } from "../../lib/actorAuthorization";
import type { Permission } from "../../types";
import { useSessionActor } from "../../context/SessionActorContext";
import { useSessionHydration } from "../../context/SessionHydrationContext";
import { useSubscription } from "../../context/SubscriptionContext";
import { hasSupabaseConfig } from "../../lib/supabase";
import { usePosStore } from "../../store/usePosStore";

type Props = {
  permission?: Permission;
  children: React.ReactNode;
};

function SessionLoadingGate() {
  return (
    <div className="flex min-h-[28vh] items-center justify-center px-4 text-sm font-semibold text-muted-foreground">
      Loading…
    </div>
  );
}

/** Enterprise HQ routes — cloud org required; single-store orgs pass automatically. */
export function EnterpriseProtectedRoute({ permission = "enterprise.access", children }: Props) {
  const actor = useSessionActor();
  const location = useLocation();
  const { authMode, loading: subscriptionLoading, snapshot } = useSubscription();
  const { roleReady } = useSessionHydration();
  const shopHydrated = usePosStore((s) => s._hydrated);

  const waitingForSession =
    authMode === "supabase" && (subscriptionLoading || !roleReady || !shopHydrated);

  if (waitingForSession) {
    return <SessionLoadingGate />;
  }

  if (!hasSupabaseConfig || authMode !== "supabase") {
    return <Navigate to="/office" replace state={{ from: location.pathname }} />;
  }

  if (!actorHasEffectivePermission(actor, permission, snapshot, authMode)) {
    return <Navigate to="/office" replace state={{ from: location.pathname, reason: permission }} />;
  }

  return <>{children}</>;
}
