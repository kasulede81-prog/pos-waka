/**
 * The one place that answers "what KIND of access does this staff member have?" for the Staff
 * Center.
 *
 * The Staff Center used to answer it with a single badge chosen from three overlapping ideas — a
 * linked cloud account, a pending upgrade, or "PIN only" — with a password and a username sitting
 * alongside the PIN as if they were three more ways to be a staff member. They are not. There are
 * exactly two kinds of access now, and they are different in kind:
 *
 *   ONLINE  — the person's own Google account, linked when they accept an invitation.
 *   OFFLINE — a PIN, a credential for a shared terminal. Never an account.
 *
 * Pure and separate from the component so the states can be tested directly rather than inferred
 * from rendered markup.
 */

import type { StaffAccount } from "../types";
import { normalizeLinkedAuthUserId } from "./sessionActor";
import { staffHasPendingUpgradeInvite, type StaffInvitationRow } from "./staffInvite";

export type StaffAccessState = {
  /** The person's Google account is linked — they can sign in to DKASU POS themselves. */
  googleLinked: boolean;
  /** An invitation has been sent and not yet accepted, so link status is genuinely undecided. */
  invitePending: boolean;
  /** No Google account and no invitation — this profile is offline-only until one is sent. */
  googleNotLinked: boolean;
  /** An offline credential exists. A record with no PIN hash has never been issued one. */
  pinConfigured: boolean;
  /** Disabled: must never be shown as able to sign in. */
  active: boolean;
};

export function staffAccessState(
  staff: StaffAccount,
  pendingInvites: readonly StaffInvitationRow[] = [],
  pendingUpgradeStaffIds: readonly string[] = [],
): StaffAccessState {
  const googleLinked = normalizeLinkedAuthUserId(staff.linkedAuthUserId) != null;
  const invitePending =
    !googleLinked &&
    (pendingUpgradeStaffIds.includes(staff.id) ||
      staffHasPendingUpgradeInvite(staff, [...pendingInvites]));

  return {
    googleLinked,
    invitePending,
    googleNotLinked: !googleLinked && !invitePending,
    pinConfigured: Boolean(staff.pinHash),
    active: staff.active !== false,
  };
}
