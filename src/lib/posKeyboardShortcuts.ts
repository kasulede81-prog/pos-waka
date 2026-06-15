export type { PosModalState, PosShortcutAction, PosShortcutModalState } from "./posModalShortcutGuard";
export { isPosModalOpen, isPosShortcutModalOpen, shouldBlockPosShortcutAction } from "./posModalShortcutGuard";

export const MONEY_INPUT_CLASS = "waka-money-input";

export function isEditableTextTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as HTMLElement;
  if (typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function isActiveMoneyInput(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as HTMLElement;
  return el.tagName === "INPUT" && el.classList.contains(MONEY_INPUT_CLASS);
}

export type MoneyInputKeyKind = "digit" | "backspace" | "decimal";

export function resolveMoneyInputKey(key: string): MoneyInputKeyKind | null {
  if (/^[0-9]$/.test(key)) return "digit";
  if (key === "Backspace") return "backspace";
  if (key === "." || key === "Decimal") return "decimal";
  return null;
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  desc?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Apply a digit/backspace/decimal key to the focused MoneyInput (React-controlled). */
export function applyMoneyInputKey(input: HTMLInputElement, key: string): boolean {
  const kind = resolveMoneyInputKey(key);
  if (!kind) return false;

  const current = input.value;
  if (kind === "backspace") {
    setNativeInputValue(input, current.slice(0, -1));
    return true;
  }
  if (kind === "decimal") {
    if (current.includes(".")) return true;
    setNativeInputValue(input, current.length ? `${current}.` : "0.");
    return true;
  }
  if (kind === "digit") {
    const next = (current + key).replace(/^0+(\d)/, "$1").slice(0, 12);
    setNativeInputValue(input, next);
    return true;
  }
  return false;
}

export function shouldIgnorePosShortcut(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "target">): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  if (isEditableTextTarget(event.target)) return true;
  return false;
}

/** Map POS page keydown to an action. Returns null when the event should propagate. */
export function resolvePosShortcutAction(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "target">,
): import("./posModalShortcutGuard").PosShortcutAction | null {
  if (shouldIgnorePosShortcut(event)) return null;

  switch (event.key) {
    case "F2":
      return "focus_search";
    case "F4":
      return "focus_checkout";
    case "F8":
      return "open_cart_discount";
    case "F9":
      return "focus_customer";
    case "Enter":
      return "confirm";
    case "Escape":
      return "close";
    case "+":
    case "=":
      return "increment_qty";
    case "-":
    case "_":
      return "decrement_qty";
    default:
      return null;
  }
}
