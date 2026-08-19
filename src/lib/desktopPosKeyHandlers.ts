/**
 * Maps physical keyboard events to POS keypad / on-screen keyboard keys.
 * Does not mutate state — callers apply via existing checkout handlers.
 */

export type DesktopKeypadKey = string;

/** Numeric keypad: digits, decimal, backspace, clear, enter, escape. */
export function mapEventToNumericKeypad(e: KeyboardEvent, allowDecimal: boolean): DesktopKeypadKey | null {
  if (e.key === "Backspace") return "back";
  if (e.key === "Delete" || e.key === "Escape") return "C";
  if (e.key === "Enter") return "enter";
  if (/^\d$/.test(e.key)) return e.key;
  if (allowDecimal && (e.key === "." || e.key === ",")) return ".";
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
