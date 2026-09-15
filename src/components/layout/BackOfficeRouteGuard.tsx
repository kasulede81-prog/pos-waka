import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Language } from "../../types";
import { useSessionActor } from "../../context/SessionActorContext";
import { useSubscription } from "../../context/SubscriptionContext";
import { actorHasEffectivePermission } from "../../lib/actorAuthorization";
import { hasBackOfficeShellAccess } from "../../lib/backOfficeAccess";
import { usePosStore } from "../../store/usePosStore";
import { isBackOfficePath, isStockKeeperPath, stockKeeperPathPermission, debtPathPermission } from "../../lib/backOfficePaths";
import { isBackOfficePinRequired } from "../../lib/backOfficeUnlock";
import { useBackOfficeSession } from "../../context/BackOfficeSessionContext";
import { BackOfficeUnlockModal } from "./BackOfficeUnlockModal";
import { BackOfficeUnlockBanner } from "./BackOfficeUnlockBanner";

type Props = { children: ReactNode; lang: Language };

export function BackOfficeRouteGuard({ children, lang }: Props) {
  const location = useLocation();
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const preferences = usePosStore((s) => s.preferences);
  const { isUnlocked, lock, touch, unlockedRole, unlockedLabel } = useBackOfficeSession();

  const needs = isBackOfficePath(location.pathname);

  useEffect(() => {
    if (!needs && isUnlocked) lock();
  }, [needs, isUnlocked, lock, location.pathname]);

  // Extend session on route changes inside Back Office (no timers / no global pointer hooks).
  useEffect(() => {
    if (!needs || !isUnlocked) return;
    touch();
  }, [location.pathname, needs, isUnlocked, touch]);

  // After taps complete, bump session — defer so iOS delivers button/link clicks first.
  useEffect(() => {
    if (!needs || !isUnlocked) return;
    const onUp = () => {
      window.setTimeout(() => {
        touch();
      }, 0);
    };
    document.addEventListener("pointerup", onUp, { passive: true });
    return () => document.removeEventListener("pointerup", onUp);
  }, [needs, isUnlocked, touch]);

  if (!needs) {
    return <>{children}</>;
  }

  const stockPerm = isStockKeeperPath(location.pathname) ? stockKeeperPathPermission(location.pathname) : null;
  const hasStockKeeperAccess =
    stockPerm != null && actorHasEffectivePermission(actor, stockPerm, snapshot, authMode);
  const debtPerm = debtPathPermission(location.pathname);
  const hasDebtAccess = debtPerm != null && actorHasEffectivePermission(actor, debtPerm, snapshot, authMode);
  const hasFullBackOffice = actorHasEffectivePermission(actor, "back_office.access", snapshot, authMode);

  if (!hasBackOfficeShellAccess({
    pathname: location.pathname,
    role: actor.role,
    snapshot,
    authMode,
    actorPermissions: actor.permissions,
  })) {
    return <Navigate to="/" replace state={{ backOfficeDenied: true }} />;
  }

  const pinRequired = isBackOfficePinRequired(preferences);
  const skipPinForLimitedAccess =
    !hasFullBackOffice && (hasStockKeeperAccess || hasDebtAccess);
  if (pinRequired && !isUnlocked && !skipPinForLimitedAccess) {
    return (
      <>
        <BackOfficeUnlockModal lang={lang} />
      </>
    );
  }

  return (
    <>
      {isUnlocked && unlockedRole ? (
        <BackOfficeUnlockBanner lang={lang} role={unlockedRole} label={unlockedLabel} />
      ) : null}
      {children}
    </>
  );
}
