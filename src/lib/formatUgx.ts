/** Full UGX amount for UI (no k / M shorthand). */
export function formatUgx(amountUgx: number): string {
  const n = Math.max(0, Math.round(amountUgx));
  return `UGX ${n.toLocaleString()}`;
}
