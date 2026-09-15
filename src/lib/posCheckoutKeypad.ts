export type CheckoutInputField = "cash" | "mobile" | "customerName" | "customerPhone";
export type CheckoutKeypadMode = "numeric" | "alpha";

/** Compact QWERTY rows — same footprint as the numeric keypad (3 letter rows + bottom controls). */
export const CHECKOUT_ALPHA_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M", "⌫"],
] as const;

export const CHECKOUT_ALPHA_ROW_COLS = [10, 9, 8] as const;

export function isTextCheckoutField(field: CheckoutInputField): boolean {
  return field === "customerName" || field === "customerPhone";
}

export function preferredKeypadModeForField(field: CheckoutInputField): CheckoutKeypadMode {
  return field === "customerName" ? "alpha" : "numeric";
}

export function applyCheckoutNumericKey(current: string, key: string): string {
  if (key === "back" || key === "⌫") return current.slice(0, -1);
  if (key === "C") return "";
  return (current + key).replace(/\D/g, "").slice(0, 10);
}

export function applyCheckoutPhoneKey(current: string, key: string): string {
  if (key === "back" || key === "⌫") return current.slice(0, -1);
  if (key === "C") return "";
  return (current + key).replace(/\D/g, "").slice(0, 15);
}

export function applyCheckoutAlphaKey(current: string, key: string): string {
  if (key === "back" || key === "⌫") return current.slice(0, -1);
  if (key === "C") return "";
  if (key === "space" || key === " ") return `${current} `;
  if (/^[a-zA-Z]$/.test(key)) {
    const next = current + key.toUpperCase();
    return next.slice(0, 80);
  }
  return current;
}
