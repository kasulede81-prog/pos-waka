import { useEffect, useState, type ReactNode } from "react";
import type { Language } from "../../types";
import { useSessionActor } from "../../context/SessionActorContext";
import { shiftOwnerUserId } from "../../lib/sessionActor";
import { getActiveShiftForActor } from "../../lib/shiftEnforcement";
import { usePosStore } from "../../store/usePosStore";
import { ShiftOpeningScreen } from "./ShiftOpeningScreen";

type Props = {
  lang: Language;
  children: ReactNode;
};

/** Requires an active shift before rendering sell-flow children. */
export function ShiftSellGateway({ lang, children }: Props) {
  const actor = useSessionActor();
  const shifts = usePosStore((s) => s.preferences.shifts);
  const ownerId = shiftOwnerUserId(actor);
  const activeShift = ownerId ? getActiveShiftForActor(shifts, ownerId) : null;
  const [gatewayCleared, setGatewayCleared] = useState(Boolean(activeShift));

  useEffect(() => {
    if (activeShift) setGatewayCleared(true);
  }, [activeShift]);

  if (!gatewayCleared && !activeShift) {
    return <ShiftOpeningScreen lang={lang} onShiftStarted={() => setGatewayCleared(true)} />;
  }

  return <>{children}</>;
}
