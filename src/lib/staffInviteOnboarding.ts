import type { Session } from "@supabase/supabase-js";
import { isStaffAcceptPagePath } from "./staffInviteAcceptAttempt";
import { isNativeApp } from "./nativeApp";
import { logStartupPhase } from "./startupDiagnostics";
import {
  acceptStaffInviteToken,
  clearStaffInviteToken,
  hasPendingStaffInviteForMe,
  isNativeOAuthReturnPath,
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
 *
 * On `/staff/accept`, the page owns acceptance — bootstrap must not race the RPC.
 */
export async function resolveStaffInviteBeforeOwnerBootstrap(
  session: Session | null,
): Promise<StaffInviteBootstrapGate> {
  if (!session?.user) {
    return { skipOwnerBootstrap: false, accepted: false };
  }

  const onAcceptPage =
    typeof window !== "undefined" && isStaffAcceptPagePath(window.location.pathname);

  /**
   * The native Google round trip leaves the WebView and returns through `wakapos://callback`,
   * which the app maps to `/auth/callback` — NOT to `/staff/accept`, the page that started it.
   * On that route the invitation must be left alone too: accepting it here would clear the
   * stored token and route to the POS before the app could hand back to `/staff/accept`.
   *
   * Native only. On web this route keeps its previous behaviour, where accepting the invitation
   * during the callback is the designed outcome.
   */
  const onNativeOAuthReturn =
    typeof window !== "undefined" &&
    isNativeOAuthReturnPath(window.location.pathname, isNativeApp());

  const token = peekStaffInviteToken();
  if (token) {
    if (onAcceptPage || onNativeOAuthReturn) {
      logStartupPhase("staff_invite_pending_skip_owner_bootstrap", {
        userId: session.user.id,
        via: onAcceptPage ? "staff_accept_page_owns_token" : "native_oauth_return_owns_token",
      });
      return { skipOwnerBootstrap: true, accepted: false };
    }
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
