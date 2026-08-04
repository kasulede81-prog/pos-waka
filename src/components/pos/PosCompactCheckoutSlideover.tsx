import type { ReactNode } from "react";
import { PosScreenPortal } from "../layout/PosScreenPortal";

type Props = {
  open: boolean;
  onClose: () => void;
  checkoutBottomPad?: string;
  children: ReactNode;
};

/**
 * Compact desktop checkout dock (768–1023).
 * Phase 32.1 — catalog stays interactive; no full-screen lock dimmer.
 */
export function PosCompactCheckoutSlideover({ open, onClose, checkoutBottomPad, children }: Props) {
  if (!open) return null;

  return (
    <PosScreenPortal>
      <div
        className="pointer-events-none fixed inset-0 z-[var(--waka-z-pos-overlay)]"
        role="dialog"
        aria-modal={false}
        aria-labelledby="pos-checkout-title"
      >
        <button
          type="button"
          className="pointer-events-auto absolute inset-y-0 left-0 right-[min(400px,34vw)] min-w-0 bg-transparent"
          onClick={onClose}
          aria-label="Close checkout"
        />
        <div
          className="pointer-events-auto absolute inset-y-0 right-0 flex w-[clamp(320px,34vw,400px)] max-w-full flex-col border-l border-border bg-waka-50 pt-[env(safe-area-inset-top,0px)] shadow-2xl"
          style={checkoutBottomPad ? { paddingBottom: checkoutBottomPad } : undefined}
        >
          {children}
        </div>
      </div>
    </PosScreenPortal>
  );
}
