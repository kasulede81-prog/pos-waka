export type PosModalState = {
  sheetOpen: boolean;
  qtyEditOpen: boolean;
  discountLineOpen: boolean;
  cartSaleDiscountOpen: boolean;
  cameraScanOpen: boolean;
  expenseModalOpen: boolean;
  firstSaleOpen: boolean;
  productLockedOpen: boolean;
  expiryWarnOpen: boolean;
  checkoutBlockModalOpen: boolean;
  receiptOpen: boolean;
  shiftCloseOpen: boolean;
};

export type PosShortcutAction =
  | "focus_search"
  | "focus_checkout"
  | "open_cart_discount"
  | "focus_customer"
  | "confirm"
  | "close"
  | "increment_qty"
  | "decrement_qty";

/** True when any POS modal/dialog that should guard shortcuts is open. */
export function isPosModalOpen(state: PosModalState): boolean {
  return (
    state.sheetOpen ||
    state.qtyEditOpen ||
    state.discountLineOpen ||
    state.cartSaleDiscountOpen ||
    state.cameraScanOpen ||
    state.expenseModalOpen ||
    state.firstSaleOpen ||
    state.productLockedOpen ||
    state.expiryWarnOpen ||
    state.checkoutBlockModalOpen ||
    state.receiptOpen ||
    state.shiftCloseOpen
  );
}

/** Block listed shortcuts while any POS modal is active. Escape is never blocked. */
export function shouldBlockPosShortcutAction(action: PosShortcutAction, modalOpen: boolean): boolean {
  if (!modalOpen) return false;
  if (action === "close" || action === "focus_search") return false;
  return (
    action === "increment_qty" ||
    action === "decrement_qty" ||
    action === "confirm" ||
    action === "focus_checkout" ||
    action === "open_cart_discount" ||
    action === "focus_customer"
  );
}

/** @deprecated Use isPosModalOpen */
export function isPosShortcutModalOpen(state: PosModalState): boolean {
  return isPosModalOpen(state);
}

export type PosShortcutModalState = PosModalState;
