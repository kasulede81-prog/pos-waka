import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Language } from "../../types";
import { hasPermission } from "../../lib/permissions";
import { useSessionActor } from "../../context/SessionActorContext";
import { usePosStore } from "../../store/usePosStore";
import { isBackOfficePath, isStockKeeperPath, stockKeeperPathPermission } from "../../lib/backOfficePaths";
import { isBackOfficePinRequired } from "../../lib/backOfficeUnlock";
import { useBackOfficeSession } from "../../context/BackOfficeSessionContext";
import { BackOfficeUnlockModal } from "./BackOfficeUnlockModal";
import { BackOfficeUnlockBanner } from "./BackOfficeUnlockBanner";

type Props = { children: ReactNode; lang: Language };

export function BackOfficeRouteGuard({ children, lang }: Props) {
  const location = useLocation();
  const actor = useSessionActor();
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
  const hasStockKeeperAccess = stockPerm != null && hasPermission(actor.role, stockPerm);
  const hasFullBackOffice = hasPermission(actor.role, "back_office.access");

  if (!hasFullBackOffice && !hasStockKeeperAccess) {
    return <Navigate to="/" replace state={{ backOfficeDenied: true }} />;
  }

  const pinRequired = isBackOfficePinRequired(preferences);
  const skipPinForStockKeeper = hasStockKeeperAccess && !hasFullBackOffice;
  if (pinRequired && !isUnlocked && !skipPinForStockKeeper) {
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
