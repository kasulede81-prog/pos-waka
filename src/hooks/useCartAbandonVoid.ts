import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  cartVoidCopyKeys,
  leaveSellConfirmKey,
  resolveCartAbandon,
  resolveDraftQtyChange,
  resolveRemoveDraftLine,
  type CartVoidCopyKeys,
  type CartVoidMode,
} from "../lib/saleLifecycle";
import { registerPosLeaveGuard } from "../lib/posLeaveGuard";
import { usePosStore } from "../store/usePosStore";

type Opts = {
  lang: Language;
  mode: CartVoidMode;
  onAfterSuccessfulVoid?: () => void;
  onError?: (message: string) => void;
};

/**
 * Shared Clear / Leave-Sell Void confirmation for the active POS cart.
 * Pending leave still discards local edits only (does not create a VOIDED record).
 */
export function useCartAbandonVoid({ lang, mode, onAfterSuccessfulVoid, onError }: Opts): {
  open: boolean;
  copy: CartVoidCopyKeys;
  requestClear: () => void;
  requestRemoveLine: (productId: string) => void;
  requestSetLineQuantity: (productId: string, quantity: number) => { ok: boolean; errorKey?: string };
  keep: () => void;
  apply: () => void;
} {
  const [open, setOpen] = useState(false);
  const waitersRef = useRef<Array<(ok: boolean) => void>>([]);
  const applyingRef = useRef(false);
  const activePendingSaleId = usePosStore((s) => s.activePendingSaleId);
  const voidCurrentCart = usePosStore((s) => s.voidCurrentCart);

  const copy = useMemo(
    () => cartVoidCopyKeys({ activePendingSaleId, mode }),
    [activePendingSaleId, mode],
  );

  const flushWaiters = useCallback((ok: boolean) => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const resolve of waiters) resolve(ok);
  }, []);

  const keep = useCallback(() => {
    setOpen(false);
    flushWaiters(false);
  }, [flushWaiters]);

  const requestVoidConfirm = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      waitersRef.current.push(resolve);
      setOpen(true);
    });
  }, []);

  const requestVoidConfirmRef = useRef(requestVoidConfirm);
  const langRef = useRef(lang);
  useEffect(() => {
    requestVoidConfirmRef.current = requestVoidConfirm;
    langRef.current = lang;
  });

  const requestClear = useCallback(() => {
    const state = usePosStore.getState();
    const decision = resolveCartAbandon({
      draftLineCount: state.draftLines.length,
      activePendingSaleId: state.activePendingSaleId,
      intent: "clear",
    });
    if (decision.kind === "noop") return;
    setOpen(true);
  }, []);

  const requestRemoveLine = useCallback(
    (productId: string) => {
      const state = usePosStore.getState();
      const decision = resolveRemoveDraftLine({ draftLines: state.draftLines, productId });
      if (decision === "noop") return;
      if (decision === "confirm_void") {
        requestClear();
        return;
      }
      state.removeDraftLine(productId);
    },
    [requestClear],
  );

  const requestSetLineQuantity = useCallback(
    (productId: string, quantity: number) => {
      const state = usePosStore.getState();
      const decision = resolveDraftQtyChange({
        draftLines: state.draftLines,
        productId,
        nextQuantity: quantity,
      });
      if (decision === "confirm_void") {
        requestClear();
        return { ok: true };
      }
      return state.setDraftLineQuantity(productId, quantity);
    },
    [requestClear],
  );

  const apply = useCallback(() => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    try {
      const res = voidCurrentCart();
      if (!res.ok) {
        onError?.(t(lang, res.errorKey ?? "saleError"));
        flushWaiters(false);
        if (res.errorKey !== "saleInProgress") setOpen(false);
        return;
      }
      setOpen(false);
      onAfterSuccessfulVoid?.();
      flushWaiters(true);
    } finally {
      applyingRef.current = false;
    }
  }, [flushWaiters, lang, onAfterSuccessfulVoid, onError, voidCurrentCart]);

  useEffect(() => {
    return registerPosLeaveGuard({
      hasActiveSale: () => usePosStore.getState().draftLines.length > 0,
      confirmLeave: async () => {
        const state = usePosStore.getState();
        const decision = resolveCartAbandon({
          draftLineCount: state.draftLines.length,
          activePendingSaleId: state.activePendingSaleId,
          intent: "leave",
        });
        if (decision.kind === "noop") return true;
        if (decision.kind === "discard_pending_edits") {
          const key = leaveSellConfirmKey(state.activePendingSaleId);
          const ok = window.confirm(t(langRef.current, key));
          if (ok) usePosStore.getState().clearDraft();
          return ok;
        }
        return requestVoidConfirmRef.current();
      },
    });
  }, []);

  return { open, copy, requestClear, requestRemoveLine, requestSetLineQuantity, keep, apply };
}
