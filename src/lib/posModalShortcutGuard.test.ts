import { describe, expect, it } from "vitest";
import { isPosModalOpen, shouldBlockPosShortcutAction } from "./posModalShortcutGuard";

const closedModals = {
  sheetOpen: false,
  qtyEditOpen: false,
  discountLineOpen: false,
  cartSaleDiscountOpen: false,
  cameraScanOpen: false,
  expenseModalOpen: false,
  firstSaleOpen: false,
  productLockedOpen: false,
  expiryWarnOpen: false,
  checkoutBlockModalOpen: false,
  receiptOpen: false,
  shiftCloseOpen: false,
};

describe("isPosModalOpen", () => {
  it("returns false when no modal is open", () => {
    expect(isPosModalOpen(closedModals)).toBe(false);
  });

  it("returns true for each guarded modal type", () => {
    expect(isPosModalOpen({ ...closedModals, sheetOpen: true })).toBe(true);
    expect(isPosModalOpen({ ...closedModals, qtyEditOpen: true })).toBe(true);
    expect(isPosModalOpen({ ...closedModals, discountLineOpen: true })).toBe(true);
    expect(isPosModalOpen({ ...closedModals, cartSaleDiscountOpen: true })).toBe(true);
    expect(isPosModalOpen({ ...closedModals, cameraScanOpen: true })).toBe(true);
    expect(isPosModalOpen({ ...closedModals, expenseModalOpen: true })).toBe(true);
    expect(isPosModalOpen({ ...closedModals, firstSaleOpen: true })).toBe(true);
    expect(isPosModalOpen({ ...closedModals, productLockedOpen: true })).toBe(true);
  });
});

describe("shouldBlockPosShortcutAction", () => {
  it("blocks Enter, F4, F8, F9, and +/- while a modal is open", () => {
    expect(shouldBlockPosShortcutAction("focus_checkout", true)).toBe(true);
    expect(shouldBlockPosShortcutAction("open_cart_discount", true)).toBe(true);
    expect(shouldBlockPosShortcutAction("focus_customer", true)).toBe(true);
    expect(shouldBlockPosShortcutAction("confirm", true)).toBe(true);
    expect(shouldBlockPosShortcutAction("increment_qty", true)).toBe(true);
    expect(shouldBlockPosShortcutAction("decrement_qty", true)).toBe(true);
  });

  it("does not block Escape or F2 while a modal is open", () => {
    expect(shouldBlockPosShortcutAction("close", true)).toBe(false);
    expect(shouldBlockPosShortcutAction("focus_search", true)).toBe(false);
  });

  it("does not block shortcuts when no modal is open", () => {
    expect(shouldBlockPosShortcutAction("confirm", false)).toBe(false);
    expect(shouldBlockPosShortcutAction("focus_checkout", false)).toBe(false);
  });
});
