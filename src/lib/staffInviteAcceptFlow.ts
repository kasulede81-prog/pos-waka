import type { StaffInviteAcceptResult } from "./staffInvite";
import { withTimeout } from "./promiseTimeout";

export const STAFF_INVITE_ACCEPT_TIMEOUT_MS = 12_000;

type AcceptDeps = {
  token: string;
  timeoutMs?: number;
  acceptInviteToken: (token: string) => Promise<StaffInviteAcceptResult>;
  getAuthUserId: () => Promise<string | null>;
  hydrateStaffWorkspace: (userId: string) => Promise<void>;
  clearStoredInviteToken: () => void;
};

export type StaffInviteAcceptFlowResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Guarantees a terminal result (success/error) for the invite-accepting flow.
 * This prevents the UI from being stuck in "accepting" forever.
 */
export async function runStaffInviteAcceptFlow(deps: AcceptDeps): Promise<StaffInviteAcceptFlowResult> {
  const timeoutMs = deps.timeoutMs ?? STAFF_INVITE_ACCEPT_TIMEOUT_MS;
  const timeoutFallback: StaffInviteAcceptResult = { ok: false, error: "timeout" };

  try {
    const accepted = await withTimeout(deps.acceptInviteToken(deps.token), timeoutMs, timeoutFallback);
    if (!accepted.ok) return { ok: false, error: accepted.error };

    const userId = await deps.getAuthUserId();
    if (userId) {
      await deps.hydrateStaffWorkspace(userId);
    }

    deps.clearStoredInviteToken();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error && err.message.trim() ? err.message : "accept_failed",
    };
  }
}
