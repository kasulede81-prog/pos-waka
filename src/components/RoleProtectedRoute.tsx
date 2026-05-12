import { Navigate, useLocation } from "react-router-dom";
import type { Permission } from "../types";
import { hasPermission } from "../lib/permissions";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";

type Props = {
  permission: Permission;
  children: React.ReactNode;
};

export function RoleProtectedRoute({ permission, children }: Props) {
  const actor = useSessionActor();
  const location = useLocation();
  const { snapshot, authMode, loading } = useSubscription();

  if (!hasPermission(actor.role, permission)) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  if (authMode === "supabase" && loading) {
    return (
      <div className="flex min-h-[28vh] items-center justify-center px-4 text-sm font-semibold text-stone-500">
        Loading…
      </div>
    );
  }

  if (!hasEffectivePermission(actor.role, permission, snapshot, authMode)) {
    return <Navigate to="/upgrade" replace state={{ from: location.pathname, needsPlan: true }} />;
  }

  return <>{children}</>;
}
