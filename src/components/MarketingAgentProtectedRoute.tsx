import { Navigate, useLocation } from "react-router-dom";
import { actorHasEffectivePermission } from "../lib/actorAuthorization";
import { useSessionActor } from "../context/SessionActorContext";
import { useSessionHydration } from "../context/SessionHydrationContext";
import { useSubscription } from "../context/SubscriptionContext";
import { useMarketingAgentPortal } from "../hooks/useMarketingAgentPortal";

import { usePosStore } from "../store/usePosStore";

type Props = {
  children: React.ReactNode;
};

function SessionLoadingGate() {
  return (
    <div className="flex min-h-[28vh] items-center justify-center px-4 text-sm font-semibold text-stone-500">
      Loading…
    </div>
  );
}

/** Agent portal is open to registered marketing agents regardless of shop role. */
export function MarketingAgentProtectedRoute({ children }: Props) {
  const actor = useSessionActor();
  const location = useLocation();
  const { authMode, loading: subscriptionLoading, snapshot } = useSubscription();
  const { roleReady } = useSessionHydration();
  const shopHydrated = usePosStore((s) => s._hydrated);
  const { isMarketingAgent, loading: agentLoading } = useMarketingAgentPortal();

  const waitingForSession =
    authMode === "supabase" && (subscriptionLoading || !roleReady || !shopHydrated || agentLoading);

  if (waitingForSession) {
    return <SessionLoadingGate />;
  }

  const hasBackOfficeAccess = actorHasEffectivePermission(actor, "settings.view", snapshot, authMode);
  if (!isMarketingAgent && !hasBackOfficeAccess) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
