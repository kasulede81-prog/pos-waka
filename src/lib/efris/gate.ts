/**
 * Fail-closed: EFRIS work runs only when the shop flag is explicitly true.
 * Missing config, fetch errors, and local-only mode all mean disabled.
 */
export function isEfrisEnabled(enabled: boolean | null | undefined): boolean {
  return enabled === true;
}
