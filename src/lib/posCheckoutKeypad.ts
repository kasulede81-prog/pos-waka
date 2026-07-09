export type CheckoutInputField = "cash" | "mobile" | "customerName" | "customerPhone";
export type CheckoutKeypadMode = "numeric" | "alpha";

/** Letter rows for the compact POS alpha keyboard (3 columns). */
export const CHECKOUT_ALPHA_ROWS = [
  ["A", "B", "C"],
  ["D", "E", "F"],
  ["G", "H", "I"],
  ["J", "K", "L"],
  ["M", "N", "O"],
  ["P", "Q", "R"],
  ["S", "T", "U"],
  ["V", "W", "X"],
  ["Y", "Z", "⌫"],
] as const;

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
