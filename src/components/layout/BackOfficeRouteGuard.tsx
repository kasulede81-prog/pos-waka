import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Language } from "../../types";
import { hasPermission } from "../../lib/permissions";
import { useSessionActor } from "../../context/SessionActorContext";
import { usePosStore } from "../../store/usePosStore";
import { isBackOfficePath } from "../../lib/backOfficePaths";
import { useBackOfficeSession } from "../../context/BackOfficeSessionContext";
import { BackOfficeUnlockModal } from "./BackOfficeUnlockModal";

type Props = { children: ReactNode; lang: Language };

export function BackOfficeRouteGuard({ children, lang }: Props) {
  const location = useLocation();
  const actor = useSessionActor();
  const pin = usePosStore((s) => s.preferences.backOfficePin);
  const { isUnlocked, lock, touch } = useBackOfficeSession();

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

  if (!hasPermission(actor.role, "back_office.access")) {
    return <Navigate to="/" replace state={{ backOfficeDenied: true }} />;
  }

  const pinRequired = Boolean(pin && String(pin).length > 0);
  if (pinRequired && !isUnlocked) {
    return (
      <>
        <BackOfficeUnlockModal lang={lang} />
      </>
    );
  }

  return <>{children}</>;
}
