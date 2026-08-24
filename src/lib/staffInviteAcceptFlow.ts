import type { StaffInviteAcceptResult } from "./staffInvite";
import { withTimeout } from "./promiseTimeout";

export const STAFF_INVITE_ACCEPT_TIMEOUT_MS = 12_000;
/** Post-accept workspace hydrate is best-effort; must not pin the accept spinner. */
export const STAFF_INVITE_HYDRATE_TIMEOUT_MS = 8_000;

type AcceptDeps = {
  token: string;
  timeoutMs?: number;
  hydrateTimeoutMs?: number;
  acceptInviteToken: (token: string) => Promise<StaffInviteAcceptResult>;
  getAuthUserId: () => Promise<string | null>;
  hydrateStaffWorkspace: (userId: string) => Promise<void>;
  clearStoredInviteToken: () => void;
};

export type StaffInviteAcceptFlowResult =
  | { ok: true; hydrateDegraded?: boolean }
  | { ok: false; error: string };

/**
 * Guarantees a terminal result (success/error) for the invite-accepting flow.
 * RPC acceptance is authoritative; workspace hydrate is bounded and best-effort.
 */
export async function runStaffInviteAcceptFlow(deps: AcceptDeps): Promise<StaffInviteAcceptFlowResult> {
  const timeoutMs = deps.timeoutMs ?? STAFF_INVITE_ACCEPT_TIMEOUT_MS;
  const hydrateTimeoutMs = deps.hydrateTimeoutMs ?? STAFF_INVITE_HYDRATE_TIMEOUT_MS;
  const timeoutFallback: StaffInviteAcceptResult = { ok: false, error: "timeout" };

  try {
    const accepted = await withTimeout(deps.acceptInviteToken(deps.token), timeoutMs, timeoutFallback);
    if (!accepted.ok) return { ok: false, error: accepted.error };

    let hydrateDegraded = false;
    const userId = await deps.getAuthUserId();
    if (userId) {
      const hydrateOk = await withTimeout(
        deps
          .hydrateStaffWorkspace(userId)
          .then(() => true)
          .catch(() => false),
        hydrateTimeoutMs,
        false,
      );
      hydrateDegraded = !hydrateOk;
    }

    deps.clearStoredInviteToken();
    return hydrateDegraded ? { ok: true, hydrateDegraded: true } : { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error && err.message.trim() ? err.message : "accept_failed",
    };
  }
}
