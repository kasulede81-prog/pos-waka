import { Navigate, useLocation } from "react-router-dom";
import type { Permission } from "../types";
import { useSessionActor } from "../context/SessionActorContext";
import { useSessionHydration } from "../context/SessionHydrationContext";
import { useSubscription } from "../context/SubscriptionContext";
import { actorHasEffectivePermission, actorHasPermission } from "../lib/actorAuthorization";
import {
  canAccessSettingsCapability,
  capabilityForSettingsPath,
  resolveSettingsCapabilityDenialTarget,
  type SettingsCapabilityId,
} from "../lib/settingsCapabilityMatrix";
import { usePosStore } from "../store/usePosStore";

type Props = {
  permission: Permission;
  /** Settings access contract — hub, route, and mutation share this id. */
  capability?: SettingsCapabilityId;
  children: React.ReactNode;
};

function SessionLoadingGate() {
  return (
    <div className="flex min-h-[28vh] items-center justify-center px-4 text-sm font-semibold text-muted-foreground">
      Loading…
    </div>
  );
}

function legacyDenialTarget(permission: Permission, pathname: string): string {
  const tierGated =
    permission === "reports.profit" ||
    permission === "owner.dashboard" ||
    permission === "owner.activity" ||
    permission === "owner.cash_history" ||
    permission === "settings.shop";
  const settingsSubpage = pathname.startsWith("/settings/");
  if (tierGated) return "/upgrade";
  if (settingsSubpage) return "/settings";
  return "/";
}

export function RoleProtectedRoute({ permission, capability, children }: Props) {
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

  const pathCapability =
    location.pathname.startsWith("/settings/") || location.pathname.startsWith("/staff-center")
      ? capabilityForSettingsPath(location.pathname)
      : null;
  const capabilityId = capability ?? pathCapability;

  if (capabilityId) {
    if (!canAccessSettingsCapability(actor, capabilityId, snapshot, authMode)) {
      const to =
        resolveSettingsCapabilityDenialTarget(actor, capabilityId, snapshot, authMode) ?? "/";
      return <Navigate to={to} replace state={{ from: location.pathname }} />;
    }
    return <>{children}</>;
  }

  if (!actorHasEffectivePermission(actor, permission, snapshot, authMode)) {
    const settingsSubpage = location.pathname.startsWith("/settings/");
    const hasRole = actorHasPermission(actor, permission);
    const to =
      !hasRole && settingsSubpage
        ? "/settings"
        : legacyDenialTarget(permission, location.pathname);
    return (
      <Navigate
        to={to}
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  return <>{children}</>;
}
