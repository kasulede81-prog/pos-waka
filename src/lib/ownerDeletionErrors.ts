/**
 * Owner-facing deletion errors. Technical details stay off the delete page.
 */

export type OwnerDeletionFailureKind =
  | "FUNCTION_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "AUTH_REQUIRED"
  | "REAUTH_REQUIRED"
  | "VALIDATION_ERROR"
  | "DELETE_FAILED"
  | "PARTIAL_DELETE"
  | "SERVER_ERROR"
  | "UNKNOWN_ERROR";

export const OWNER_DELETION_SAFE_MESSAGES = {
  infrastructure:
    "We couldn't complete the deletion right now. Your organization has not been deleted. Please try again later or contact WAKA Support.",
  reauth: "Please verify your identity again before deleting your organization.",
  validation: "The confirmation text doesn't match. Please enter the required confirmation exactly.",
  partial:
    "Your organization data was partially deleted, but account cleanup could not be completed. Please use Retry cleanup or contact WAKA Support.",
} as const;

const LEAK_PATTERNS = [
  /npm run supabase:deploy/i,
  /deploy supabase edge function/i,
  /edge function/i,
  /supabase/i,
  /\brpc\b/i,
  /migration \d+/i,
  /could not find the function/i,
  /sqlerrm/i,
  /postgres/i,
  /owner-permanently-delete-account/i,
  /certified_hard_delete/i,
  /owner_permanently_delete/i,
];

export function looksLikeInternalDeletionLeak(text: string | null | undefined): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  return LEAK_PATTERNS.some((re) => re.test(raw));
}

export function classifyOwnerDeletionFailure(input: {
  error?: string | null;
  detail?: string | null;
  message?: string | null;
  transportCode?: string | null;
  partial?: boolean;
}): OwnerDeletionFailureKind {
  const code = String(input.error ?? "").toLowerCase();
  const blob = `${input.detail ?? ""} ${input.message ?? ""} ${input.transportCode ?? ""}`.toLowerCase();

  if (input.partial || code === "auth_delete_failed" || code === "partial") return "PARTIAL_DELETE";
  if (code === "verification_failed") return input.partial ? "PARTIAL_DELETE" : "DELETE_FAILED";
  if (code === "confirmation_required" || code === "invalid_body") return "VALIDATION_ERROR";
  if (code === "reauth_required") return "REAUTH_REQUIRED";
  if (code === "unauthorized") return "AUTH_REQUIRED";
  if (code === "forbidden" || code === "permission_denied" || code === "cannot_delete_internal_admin") {
    return "DELETE_FAILED";
  }
  if (
    input.transportCode === "function_not_deployed" ||
    code === "function_not_deployed" ||
    code === "migration_not_deployed"
  ) {
    return "FUNCTION_UNAVAILABLE";
  }
  if (input.transportCode === "timeout" || input.transportCode === "network" || blob.includes("timed out")) {
    return "NETWORK_ERROR";
  }
  if (code === "shop_not_found" || blob.includes("shop_not_found") || code === "delete_failed" || code === "retry_not_applicable") {
    return "DELETE_FAILED";
  }
  if (code === "server_misconfigured") return "SERVER_ERROR";
  return "UNKNOWN_ERROR";
}

export function ownerFacingDeletionMessage(kind: OwnerDeletionFailureKind): string {
  switch (kind) {
    case "REAUTH_REQUIRED":
    case "AUTH_REQUIRED":
      return OWNER_DELETION_SAFE_MESSAGES.reauth;
    case "VALIDATION_ERROR":
      return OWNER_DELETION_SAFE_MESSAGES.validation;
    case "PARTIAL_DELETE":
      return OWNER_DELETION_SAFE_MESSAGES.partial;
    default:
      return OWNER_DELETION_SAFE_MESSAGES.infrastructure;
  }
}

export function sanitizeOwnerDeletionMessage(
  raw: string | null | undefined,
  kind: OwnerDeletionFailureKind,
): string {
  const safe = ownerFacingDeletionMessage(kind);
  const text = String(raw ?? "").trim();
  if (!text || looksLikeInternalDeletionLeak(text)) return safe;
  if (kind === "PARTIAL_DELETE" || kind === "VALIDATION_ERROR" || kind === "REAUTH_REQUIRED") {
    return text.length > 180 ? safe : text;
  }
  return safe;
}
