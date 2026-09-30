/**
 * Loyalty RPC error code → translation key.
 *
 * The loyalty RPCs return machine codes (`loyalty_member_limit_reached`,
 * `account_revoked`, …). Merchants must never see those raw, and they must not be
 * flattened into one useless "something went wrong" either: a member-allowance block
 * needs to say exactly that, because it is actionable (free a slot, then retry).
 */

const KEYS: Record<string, string> = {
  loyalty_member_limit_reached: "loyaltyErrLimitReached",
  loyalty_not_enabled: "loyaltyErrNotEnabled",
  account_revoked: "loyaltyErrAccountRevoked",
  account_not_found: "loyaltyErrAccountNotFound",
  account_suspended: "loyaltyErrAccountSuspended",
  membership_expired: "loyaltyErrMembershipExpired",
  already_member: "loyaltyErrAlreadyMember",
  already_reviewed: "loyaltyErrAlreadyReviewed",
  request_not_found: "loyaltyErrRequestNotFound",
  customer_not_in_shop: "loyaltyErrCustomerNotInShop",
  invalid_action: "loyaltyErrInvalidAction",
  invalid_status: "loyaltyErrInvalidStatus",
  invalid_reason: "loyaltyErrInvalidReason",
  program_not_found: "loyaltyErrProgramNotFound",
  loyalty_enrollment_cooldown: "loyaltyErrCooldown",
  loyalty_request_queue_full: "loyaltyErrQueueFull",
  loyalty_request_already_settled: "loyaltyErrAlreadyReviewed",
  loyalty_request_invalid_transition: "loyaltyErrAlreadyReviewed",
  forbidden: "notifyPermissionDenied",
  offline: "loyaltyErrOffline",
  loyalty_unavailable: "loyaltyErrOffline",
};

/**
 * Translation key for a loyalty error code. Unknown codes fall back to a generic
 * message rather than leaking the code or implying a cause we cannot substantiate.
 */
export function loyaltyErrorKey(code: string | null | undefined): string {
  const c = (code ?? "").trim();
  return KEYS[c] ?? "loyaltyErrGeneric";
}

/**
 * The same idea, for the MEMBER's own "Add to Google Wallet".
 *
 * Deliberately not folded into `loyaltyErrorKey`: its fallback is `loyaltyErrGeneric`, which is
 * merchant-facing copy ("ask an administrator", "the shop…"), and the codes below arrive from a
 * different chain — `loyalty-wallet-pass` answering a member rather than an RPC answering staff.
 * A customer must be told what THEY can do, and the three cases that matter here are "the card is
 * not active", "there is no card here for you" and "it did not work, try again".
 */
export function memberWalletErrorKey(code: string | null | undefined): string {
  const c = (code ?? "").trim();
  if (c === "account_revoked" || c === "account_inactive" || c === "membership_expired") {
    return "loyaltyWalletMemberInactive";
  }
  if (c === "not_found" || c === "not_a_member" || c === "account_not_found" || c === "shop_not_found") {
    return "loyaltyWalletMemberNoCard";
  }
  return "loyaltyWalletMemberFailed";
}
