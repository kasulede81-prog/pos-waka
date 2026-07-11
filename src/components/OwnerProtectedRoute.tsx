import { Navigate } from "react-router-dom";
import { useSessionActor } from "../context/SessionActorContext";
import { useSessionHydration } from "../context/SessionHydrationContext";
import { useSubscription } from "../context/SubscriptionContext";
import { hasSupabaseConfig } from "../lib/supabase";
import { usePosStore } from "../store/usePosStore";

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

/** Owner-only routes — subscription tier must not gate account deletion or similar flows. */
export function OwnerProtectedRoute({ children }: Props) {
  const actor = useSessionActor();
  const { authMode, loading: subscriptionLoading } = useSubscription();
  const { roleReady } = useSessionHydration();
  const shopHydrated = usePosStore((s) => s._hydrated);

  const waitingForSession =
    authMode === "supabase" && (subscriptionLoading || !roleReady || !shopHydrated);

  if (waitingForSession) {
    return <SessionLoadingGate />;
  }

  if (!hasSupabaseConfig || authMode !== "supabase" || actor.role !== "owner") {
    return <Navigate to="/office/account" replace />;
  }

  return <>{children}</>;
}
