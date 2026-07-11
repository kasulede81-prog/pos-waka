import { Navigate, useLocation } from "react-router-dom";
import type { Permission } from "../types";
import { useSessionActor } from "../context/SessionActorContext";
import { useSessionHydration } from "../context/SessionHydrationContext";
import { useSubscription } from "../context/SubscriptionContext";
import { actorHasEffectivePermission } from "../lib/actorAuthorization";import { usePosStore } from "../store/usePosStore";

type Props = {
  permission: Permission;
  children: React.ReactNode;
};

function SessionLoadingGate() {
  return (
    <div className="flex min-h-[28vh] items-center justify-center px-4 text-sm font-semibold text-muted-foreground">
      Loading…
    </div>
  );
}

export function RoleProtectedRoute({ permission, children }: Props) {
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

  if (!actorHasEffectivePermission(actor, permission, snapshot, authMode)) {
    const tierGated =
      permission === "reports.profit" ||
      permission === "owner.dashboard" ||
      permission === "owner.activity" ||
      permission === "owner.cash_history" ||
      permission === "settings.shop";
    return <Navigate to={tierGated ? "/upgrade" : "/"} replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

