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
