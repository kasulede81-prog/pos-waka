/**
 * Merchant-side enrollment request queue (Phase 2).
 *
 * A public QR submission becomes a PENDING request; only a merchant decision turns it
 * into a membership. Every call here goes through a SECURITY DEFINER RPC — the browser
 * never writes `loyalty_accounts` or `loyalty_enrollment_requests` directly, and the
 * approval RPC re-checks the entitlement and the member allowance in the database.
 */

import { hasSupabaseConfig, supabase } from "../supabase";

export type EnrollmentRequestStatus = "pending" | "approved" | "rejected";

export type EnrollmentRequestRow = {
  id: string;
  name: string;
  phoneE164: string;
  email: string | null;
  status: EnrollmentRequestStatus;
  requestedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  approvedLoyaltyAccountId: string | null;
  matchedCustomerId: string | null;
};

export type LoyaltyUsage = {
  loyaltyEnabled: boolean;
  entitlementStatus: string;
  tierCode: string | null;
  tierName: string | null;
  memberLimit: number;
  activeMembers: number;
  remaining: number;
  atLimit: boolean;
};

export type EnrollmentRequestsResult =
  | { ok: true; requests: EnrollmentRequestRow[]; usage: LoyaltyUsage | null }
  | { ok: false; error: string };

export type ReviewEnrollmentResult =
  | {
      ok: true;
      status: EnrollmentRequestStatus;
      alreadyReviewed?: boolean;
      loyaltyAccountId?: string | null;
      customerId?: string | null;
      newMembership?: boolean;
    }
  | { ok: false; error: string; memberLimit?: number; activeCount?: number };

function normalizeStatus(value: unknown): EnrollmentRequestStatus {
  return value === "approved" || value === "rejected" ? value : "pending";
}

function mapUsage(raw: unknown): LoyaltyUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  return {
    loyaltyEnabled: u.loyalty_enabled === true,
    entitlementStatus: String(u.entitlement_status ?? "none"),
    tierCode: u.tier_code == null ? null : String(u.tier_code),
    tierName: u.tier_name == null ? null : String(u.tier_name),
    memberLimit: Number(u.member_limit ?? 0),
    activeMembers: Number(u.active_members ?? 0),
    remaining: Number(u.remaining ?? 0),
    atLimit: u.at_limit === true,
  };
}

function mapRequests(raw: unknown): EnrollmentRequestRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const r = entry as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      name: String(r.name ?? ""),
      phoneE164: String(r.phone_e164 ?? ""),
      email: r.email == null ? null : String(r.email),
      status: normalizeStatus(r.status),
      requestedAt: String(r.requested_at ?? ""),
      reviewedAt: r.reviewed_at == null ? null : String(r.reviewed_at),
      rejectionReason: r.rejection_reason == null ? null : String(r.rejection_reason),
      approvedLoyaltyAccountId:
        r.approved_loyalty_account_id == null ? null : String(r.approved_loyalty_account_id),
      matchedCustomerId: r.matched_customer_id == null ? null : String(r.matched_customer_id),
    };
  });
}

export async function listEnrollmentRequests(
  shopId: string,
  status: EnrollmentRequestStatus | "all" = "pending",
  limit = 100,
): Promise<EnrollmentRequestsResult> {
  if (!hasSupabaseConfig || !supabase) return { ok: false, error: "offline" };
  try {
    const { data, error } = await supabase.rpc("loyalty_list_enrollment_requests", {
      p_shop_id: shopId,
      p_status: status === "all" ? null : status,
      p_limit: limit,
    });
    if (error) return { ok: false, error: error.code ?? "loyalty_requests_failed" };
    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok !== true) return { ok: false, error: String(result.error ?? "forbidden") };
    return { ok: true, requests: mapRequests(result.requests), usage: mapUsage(result.usage) };
  } catch {
    return { ok: false, error: "loyalty_requests_failed" };
  }
}

export async function reviewEnrollmentRequest(input: {
  shopId: string;
  requestId: string;
  action: "approve" | "reject";
  rejectionReason?: string | null;
}): Promise<ReviewEnrollmentResult> {
  if (!hasSupabaseConfig || !supabase) return { ok: false, error: "offline" };
  try {
    const { data, error } = await supabase.rpc("loyalty_review_enrollment_request", {
      p_shop_id: input.shopId,
      p_request_id: input.requestId,
      p_action: input.action,
      p_rejection_reason: input.rejectionReason ?? null,
    });
    if (error) return { ok: false, error: error.code ?? "loyalty_review_failed" };
    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok !== true) {
      return {
        ok: false,
        error: String(result.error ?? "loyalty_review_failed"),
        memberLimit: result.member_limit == null ? undefined : Number(result.member_limit),
        activeCount: result.active_count == null ? undefined : Number(result.active_count),
      };
    }
    return {
      ok: true,
      status: normalizeStatus(result.status),
      alreadyReviewed: result.already_reviewed === true,
      loyaltyAccountId:
        result.loyalty_account_id == null ? null : String(result.loyalty_account_id),
      customerId: result.customer_id == null ? null : String(result.customer_id),
      newMembership: result.new_membership === true,
    };
  } catch {
    return { ok: false, error: "loyalty_review_failed" };
  }
}
