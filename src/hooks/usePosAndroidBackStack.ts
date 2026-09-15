import { useCallback } from "react";
import { ANDROID_BACK_PRIORITY } from "../lib/androidBackStack";
import { useAndroidBackHandler } from "./useAndroidBackHandler";
import { stopBarcodeSession } from "../services/hardware/barcodeAdapter";

export type PosBackStackState = {
  cameraScanOpen: boolean;
  setCameraScanOpen: (open: boolean) => void;
  checkoutOverlayOpen: boolean;
  setSaleCheckoutMinimized: (min: boolean) => void;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  receiptOpen: boolean;
  closeReceipt: () => void;
  checkoutBlockModalOpen: boolean;
  setCheckoutBlockModalOpen: (open: boolean) => void;
  cartSaleDiscountOpen: boolean;
  setCartSaleDiscountOpen: (open: boolean) => void;
  discountLineOpen: boolean;
  closeDiscountLine: () => void;
  qtyEditOpen: boolean;
  closeQtyEdit: () => void;
  shiftCloseOpen: boolean;
  setShiftCloseOpen: (open: boolean) => void;
  productLockedOpen: boolean;
  setProductLockedOpen: (open: boolean) => void;
  expiryWarnOpen: boolean;
  closeExpiryWarn: () => void;
  firstSaleOpen: boolean;
  dismissFirstSale: () => void;
};

/** Wires POS overlay priority for hardware back — never clears draft on back. */
export function usePosAndroidBackStack(state: PosBackStackState): void {
  const closeCamera = useCallback(() => {
    void stopBarcodeSession();
    state.setCameraScanOpen(false);
  }, [state.setCameraScanOpen]);

  const minimizeCheckout = useCallback(() => {
    state.setSaleCheckoutMinimized(true);
  }, [state.setSaleCheckoutMinimized]);

  useAndroidBackHandler("pos-camera", ANDROID_BACK_PRIORITY.camera, state.cameraScanOpen, closeCamera);
  useAndroidBackHandler(
    "pos-checkout",
    ANDROID_BACK_PRIORITY.checkout,
    state.checkoutOverlayOpen,
    minimizeCheckout,
  );
  useAndroidBackHandler(
    "pos-sheet",
    ANDROID_BACK_PRIORITY.productSheet,
    state.sheetOpen,
    () => state.setSheetOpen(false),
  );

  const modalPri = ANDROID_BACK_PRIORITY.modal;
  useAndroidBackHandler("pos-receipt", modalPri, state.receiptOpen, state.closeReceipt);
  useAndroidBackHandler(
    "pos-checkout-block",
    modalPri + 1,
    state.checkoutBlockModalOpen,
    () => state.setCheckoutBlockModalOpen(false),
  );
  useAndroidBackHandler(
    "pos-cart-discount",
    modalPri + 2,
    state.cartSaleDiscountOpen,
    () => state.setCartSaleDiscountOpen(false),
  );
  useAndroidBackHandler("pos-line-discount", modalPri + 3, state.discountLineOpen, state.closeDiscountLine);
  useAndroidBackHandler("pos-qty-edit", modalPri + 4, state.qtyEditOpen, state.closeQtyEdit);
  useAndroidBackHandler(
    "pos-shift-close",
    modalPri + 5,
    state.shiftCloseOpen,
    () => state.setShiftCloseOpen(false),
  );
  useAndroidBackHandler(
    "pos-product-locked",
    modalPri + 6,
    state.productLockedOpen,
    () => state.setProductLockedOpen(false),
  );
  useAndroidBackHandler("pos-expiry-warn", modalPri + 7, state.expiryWarnOpen, state.closeExpiryWarn);
  useAndroidBackHandler("pos-first-sale", modalPri + 8, state.firstSaleOpen, state.dismissFirstSale);
}
