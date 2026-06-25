import { describe, expect, it } from "vitest";
import { isCheckoutFocusTarget, resolveConfirmSaleAction } from "./posCheckoutFocus";

describe("posCheckoutFocus", () => {
  it("detects save button focus", () => {
    const btn = { tagName: "BUTTON" } as HTMLButtonElement;
    expect(isCheckoutFocusTarget(btn, null, btn)).toBe(true);
  });

  it("detects focus inside checkout root", () => {
    const input = { tagName: "INPUT" } as HTMLInputElement;
    const root = {
      contains: (el: Element | null) => el === input,
    } as HTMLElement;
    expect(isCheckoutFocusTarget(input, root, null)).toBe(true);
  });

  it("focuses checkout instead of finishing on full desktop when catalog focused", () => {
    const search = { tagName: "INPUT" } as HTMLInputElement;
    expect(
      resolveConfirmSaleAction({
        layoutMode: "full",
        draftLineCount: 2,
        checkoutPanelOpen: false,
        activeElement: search,
        checkoutRoot: null,
        saveButton: null,
      }),
    ).toBe("focus_checkout");
  });

  it("finishes when compact slideover is open", () => {
    expect(
      resolveConfirmSaleAction({
        layoutMode: "compact",
        draftLineCount: 1,
        checkoutPanelOpen: true,
        activeElement: null,
        checkoutRoot: null,
        saveButton: null,
      }),
    ).toBe("finish");
  });

  it("opens checkout on compact when panel closed", () => {
    expect(
      resolveConfirmSaleAction({
        layoutMode: "compact",
        draftLineCount: 1,
        checkoutPanelOpen: false,
        activeElement: null,
        checkoutRoot: null,
        saveButton: null,
      }),
    ).toBe("focus_checkout");
  });

  it("finishes on mobile checkout", () => {
    expect(
      resolveConfirmSaleAction({
        layoutMode: "mobile",
        draftLineCount: 1,
        checkoutPanelOpen: true,
        activeElement: null,
        checkoutRoot: null,
        saveButton: null,
      }),
    ).toBe("finish");
  });
});
