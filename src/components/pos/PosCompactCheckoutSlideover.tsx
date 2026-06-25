import type { ReactNode } from "react";
import { PosScreenPortal } from "../layout/PosScreenPortal";

type Props = {
  open: boolean;
  onClose: () => void;
  checkoutBottomPad?: string;
  children: ReactNode;
};

/** Right-side checkout panel for compact desktop (768–1279px). */
export function PosCompactCheckoutSlideover({ open, onClose, checkoutBottomPad, children }: Props) {
  if (!open) return null;

  return (
    <PosScreenPortal>
      <div
        className="fixed inset-0 z-[var(--waka-z-pos-overlay)]"
        role="dialog"
        aria-modal
        aria-labelledby="pos-checkout-title"
      >
        <button
          type="button"
          className="absolute inset-0 bg-stone-900/40"
          onClick={onClose}
          aria-label="Close checkout"
        />
        <div
          className="absolute inset-y-0 right-0 flex w-[clamp(360px,38vw,420px)] max-w-full flex-col bg-waka-50 pt-[env(safe-area-inset-top,0px)] shadow-2xl"
          style={checkoutBottomPad ? { paddingBottom: checkoutBottomPad } : undefined}
        >
          {children}
        </div>
      </div>
    </PosScreenPortal>
  );
}
