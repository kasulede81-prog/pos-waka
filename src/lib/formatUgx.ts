/** Full UGX amount for UI (no k / M shorthand). */
export function formatUgx(amountUgx: number): string {
  const n = Math.round(amountUgx);
  if (n < 0) return `-UGX ${Math.abs(n).toLocaleString()}`;
  return `UGX ${n.toLocaleString()}`;
}
