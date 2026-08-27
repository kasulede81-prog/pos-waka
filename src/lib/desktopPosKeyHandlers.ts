/**
 * Maps physical keyboard events to POS keypad / on-screen keyboard keys.
 * Does not mutate state — callers apply via existing checkout handlers.
 */

export type DesktopKeypadKey = string;

export const POS_CASH_KEYPAD_CAPTURE_ATTR = "posCashKeypad";

let cashKeypadHardwareCapture = false;

/** True while the POS cash keypad is open and should own hardware number keys. */
export function isPosCashKeypadHardwareCapture(): boolean {
  return cashKeypadHardwareCapture;
}

export function setPosCashKeypadHardwareCapture(open: boolean): void {
  cashKeypadHardwareCapture = open;
  if (typeof document === "undefined") return;
  if (open) document.body.setAttribute(`data-${POS_CASH_KEYPAD_CAPTURE_ATTR}`, "open");
  else document.body.removeAttribute(`data-${POS_CASH_KEYPAD_CAPTURE_ATTR}`);
}

/** Numeric keypad: digits (including Windows Numpad*), backspace, clear, enter. */
export function mapEventToNumericKeypad(e: KeyboardEvent, allowDecimal: boolean): DesktopKeypadKey | null {
  if (e.key === "Backspace") return "back";
  if (e.key === "Delete") return "C";
  if (e.key === "Enter" || e.code === "NumpadEnter") return "enter";
  if (/^\d$/.test(e.key)) return e.key;
  const numpadDigit = /^Numpad(\d)$/.exec(e.code);
  if (numpadDigit) return numpadDigit[1];
  if (allowDecimal && (e.key === "." || e.key === "," || e.code === "NumpadDecimal")) return ".";
  return null;
}

/** On-screen QWERTY: letter, space, backspace, enter, escape. */
export function mapEventToAlphaKey(
  e: KeyboardEvent,
  opts: { shift: boolean; capsLock: boolean },
): DesktopKeypadKey | null {
  if (e.key === "Backspace") return "back";
  if (e.key === "Enter") return "enter";
  if (e.key === "Escape") return "close";
  if (e.key === " ") return "space";
  if (/^[a-zA-Z]$/.test(e.key)) {
    const upper = e.key.toUpperCase();
    const useUpper = opts.shift !== opts.capsLock;
    return useUpper ? upper : upper.toLowerCase();
  }
  return null;
}

/** Symbol layer from physical keyboard when symbols mode is active. */
export function mapEventToSymbolKey(e: KeyboardEvent): DesktopKeypadKey | null {
  if (e.key === "Backspace") return "back";
  if (e.key === "Enter") return "enter";
  if (e.key === "Escape") return "close";
  if (e.key === " ") return "space";
  if (e.key.length === 1) return e.key;
  return null;
}
