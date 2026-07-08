/** Parse numpad / checkout money display strings (digits only). */
export function parseDisplayMoney(s: string): number {
  const n = Number(s.replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}
