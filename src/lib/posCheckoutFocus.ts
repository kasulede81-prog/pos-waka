import type { PosLayoutMode } from "./posLayoutMode";

/** True when focus is inside checkout (desktop Enter-to-pay guard). */
export function isCheckoutFocusTarget(
  activeElement: Element | null,
  checkoutRoot: HTMLElement | null,
  saveButton: HTMLButtonElement | null,
): boolean {
  if (!activeElement) return false;
  if (saveButton && activeElement === saveButton) return true;
  if (checkoutRoot?.contains(activeElement)) return true;
  return false;
}

export type ConfirmSaleAction = "finish" | "focus_checkout" | "noop";

export function resolveConfirmSaleAction(params: {
  layoutMode: PosLayoutMode;
  draftLineCount: number;
  checkoutPanelOpen: boolean;
  activeElement: Element | null;
  checkoutRoot: HTMLElement | null;
  saveButton: HTMLButtonElement | null;
}): ConfirmSaleAction {
  if (params.draftLineCount <= 0) return "noop";
  if (params.checkoutPanelOpen) return "finish";
  if (params.layoutMode === "full") {
    return isCheckoutFocusTarget(params.activeElement, params.checkoutRoot, params.saveButton)
      ? "finish"
      : "focus_checkout";
  }
  if (params.layoutMode === "compact" || params.layoutMode === "mobile") {
    return "focus_checkout";
  }
  return "noop";
}
