/**
 * Router-level gate for /internal/waka/* — pure logic tested without React mount.
 */

export type InternalAdminGateState = "loading" | "allowed" | "denied";

export function resolveInternalAdminGateState(input: {
  previewRequested: boolean;
  /** undefined = admin check still in flight; null = resolved non-admin. */
  adminRow: unknown | null | undefined;
}): InternalAdminGateState {
  if (input.previewRequested) return "allowed";
  if (input.adminRow === undefined) return "loading";
  return input.adminRow ? "allowed" : "denied";
}

/** Child admin routes must not mount unless gate is allowed. */
export function shouldMountInternalAdminOutlet(state: InternalAdminGateState): boolean {
  return state === "allowed";
}
