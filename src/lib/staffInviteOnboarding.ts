import type { Session } from "@supabase/supabase-js";
import { logStartupPhase } from "./startupDiagnostics";
import {
  acceptStaffInviteToken,
  clearStaffInviteToken,
  hasPendingStaffInviteForMe,
  peekStaffInviteToken,
} from "./staffInvite";

export type StaffInviteBootstrapGate = {
  skipOwnerBootstrap: boolean;
  accepted: boolean;
};

/**
 * Accept a stored staff invite (if any) before owner workspace bootstrap.
 * A pending invite for this email also skips bootstrap so an invitee cannot
 * become owner of a new empty shop.
 */
export async function resolveStaffInviteBeforeOwnerBootstrap(
  session: Session | null,
): Promise<StaffInviteBootstrapGate> {
  if (!session?.user) {
    return { skipOwnerBootstrap: false, accepted: false };
  }

  const token = peekStaffInviteToken();
  if (token) {
    const accepted = await acceptStaffInviteToken(token);
    if (accepted.ok) {
      clearStaffInviteToken();
      logStartupPhase("staff_invite_accepted", {
        userId: session.user.id,
        shopId: accepted.shopId,
      });
      return { skipOwnerBootstrap: true, accepted: true };
    }
    if (accepted.error === "already_accepted" || accepted.error === "already_member") {
      clearStaffInviteToken();
      return { skipOwnerBootstrap: true, accepted: false };
    }
  }

  const pending = await hasPendingStaffInviteForMe();
  if (pending) {
    logStartupPhase("staff_invite_pending_skip_owner_bootstrap", {
      userId: session.user.id,
    });
    return { skipOwnerBootstrap: true, accepted: false };
  }

  return { skipOwnerBootstrap: false, accepted: false };
}
