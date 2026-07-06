import { useCallback, useMemo, useState } from "react";
import type { PharmacyPrescription } from "../types";
import { usePosStore } from "../store/usePosStore";
import {
  evaluateControlledCheckout,
  shouldOpenControlledGate,
  type ControlledCheckoutContext,
} from "../lib/pharmacyControlledCheckout";
import type { ControlledDispenseValidation } from "../lib/pharmacyControlledMedicine";

type FinalizeOpts = Parameters<ReturnType<typeof usePosStore.getState>["finalizeDraftSale"]>[0];
type FinalizeResult = ReturnType<ReturnType<typeof usePosStore.getState>["finalizeDraftSale"]>;

export function usePharmacyControlledCheckout(prescription: PharmacyPrescription | null = null) {
  const preferences = usePosStore((s) => s.preferences);
  const products = usePosStore((s) => s.products);
  const draftLines = usePosStore((s) => s.draftLines);
  const pharmacyDispenseCompliance = usePosStore((s) => s.pharmacyDispenseCompliance);
  const finalizeDraftSale = usePosStore((s) => s.finalizeDraftSale);

  const [gateOpen, setGateOpen] = useState(false);

  const checkoutContext: ControlledCheckoutContext = useMemo(
    () => ({
      lines: draftLines,
      products,
      preferences,
      prescription,
      compliance: pharmacyDispenseCompliance,
    }),
    [draftLines, products, preferences, prescription, pharmacyDispenseCompliance],
  );

  const validation: ControlledDispenseValidation = useMemo(
    () => evaluateControlledCheckout(checkoutContext),
    [checkoutContext],
  );

  const runFinalize = useCallback(
    (opts: FinalizeOpts): FinalizeResult => finalizeDraftSale(opts),
    [finalizeDraftSale],
  );

  const attemptFinalize = useCallback(
    (opts: FinalizeOpts): FinalizeResult & { gateOpened?: boolean } => {
      const liveValidation = evaluateControlledCheckout({
        ...checkoutContext,
        lines: usePosStore.getState().draftLines,
        compliance: usePosStore.getState().pharmacyDispenseCompliance,
      });
      if (shouldOpenControlledGate(liveValidation)) {
        setGateOpen(true);
        return { ok: false, errorKey: "pharmacyControlledApprovalRequired", gateOpened: true };
      }
      return runFinalize(opts);
    },
    [checkoutContext, runFinalize],
  );

  return {
    gateOpen,
    setGateOpen,
    validation,
    attemptFinalize,
    runFinalize,
    hasControlledLines: validation.controlledLines.length > 0,
  };
}
