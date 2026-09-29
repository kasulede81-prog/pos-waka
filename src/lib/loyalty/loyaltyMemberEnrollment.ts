/**
 * Phase 2D — a member's own enrollment request status, and the realtime nudge that keeps it fresh.
 *
 * WHAT THIS IS NOT. Realtime is never an authority here. A `postgres_changes` event says only
 * "something changed"; it carries no entitlement, and the client never routes anywhere on the
 * strength of one. Every signal — realtime, reconnect, tab wake, or the fallback tick — funnels
 * into `refreshMemberEnrollmentStatus()`, which asks the server. Membership itself is created by
 * the merchant's approval and by nothing else.
 *
 * That shape is deliberate and follows the existing `useRemoteSupportRequestListener`, whose own
 * comment records the same lesson: *"Realtime is a nudge only… Inbox RPC is authoritative."*
 *
 * The RPC takes no arguments — it resolves the member from `auth.uid()` — so there is nothing here
 * to scope client-side, and no way to ask about anybody else.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { hasSupabaseConfig, supabase } from "../supabase";

export type EnrollmentRequestStatus = "pending" | "approved" | "rejected" | "expired";

export type MemberEnrollmentRequest = {
  requestId: string;
  shopName: string;
  status: EnrollmentRequestStatus;
  requestedAt: string | null;
  reviewedAt: string | null;
};

export type EnrollmentStatusResult =
  | { ok: true; requests: MemberEnrollmentRequest[] }
  | { ok: false; error: string };

function parseStatus(raw: unknown): EnrollmentRequestStatus {
  return raw === "approved" || raw === "rejected" || raw === "expired" ? raw : "pending";
}

/** The authoritative read. Everything else in this module exists to decide WHEN to call it. */
export async function fetchMemberEnrollmentStatus(): Promise<EnrollmentStatusResult> {
  if (!hasSupabaseConfig || !supabase) return { ok: false, error: "offline" };
  try {
    // No arguments — the server derives the member from the session.
    const { data, error } = await supabase.rpc("loyalty_member_enrollment_status");
    if (error) return { ok: false, error: "unavailable" };
    const raw = (typeof data === "string" ? JSON.parse(data) : data) as Record<string, unknown> | null;
    if (!raw || raw.ok !== true) return { ok: false, error: String(raw?.error ?? "unavailable") };

    const list = Array.isArray(raw.requests) ? (raw.requests as Record<string, unknown>[]) : [];
    return {
      ok: true,
      requests: list.map((r) => ({
        requestId: String(r.request_id ?? ""),
        shopName: String(r.shop_name ?? ""),
        status: parseStatus(r.status),
        requestedAt: r.requested_at == null ? null : String(r.requested_at),
        reviewedAt: r.reviewed_at == null ? null : String(r.reviewed_at),
      })),
    };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** The state the member surface should show, derived from the server's answer. */
export type MemberEnrollmentState =
  | { kind: "none" }
  | { kind: "pending"; request: MemberEnrollmentRequest }
  | { kind: "rejected"; request: MemberEnrollmentRequest }
  | { kind: "approved"; request: MemberEnrollmentRequest };

/**
 * Which request the member is currently waiting on, if any.
 *
 * `pending` wins over a `rejected` history, because a member who was refused by one merchant and is
 * waiting on another should see the thing that is still in motion. A rejection is only shown when
 * nothing is pending, so an old refusal never masks a live request.
 */
export function resolveEnrollmentState(requests: MemberEnrollmentRequest[]): MemberEnrollmentState {
  const pending = requests.find((r) => r.status === "pending");
  if (pending) return { kind: "pending", request: pending };

  const approved = requests.find((r) => r.status === "approved");
  if (approved) return { kind: "approved", request: approved };

  const rejected = requests.find((r) => r.status === "rejected");
  if (rejected) return { kind: "rejected", request: rejected };

  return { kind: "none" };
}

/** Fallback cadence. Realtime is primary; this only covers a subscription that never arrives. */
export const ENROLLMENT_FALLBACK_POLL_MS = 30_000;

/**
 * Subscribe to the member's own enrollment rows. Returns a teardown function.
 *
 * NO FILTER is passed, and that is intentional: Row Level Security is the boundary, not the filter.
 * `postgres_changes` only delivers rows the subscriber may SELECT, and the policy added in
 * `20260929160000` permits exactly the rows carrying this member's own `member_id` (plus, for a
 * dual-identity account, their own shop's queue — which is also theirs to see). A client-side
 * filter would be a convenience, never a control, so there is no pretence of one.
 *
 * `onSignal` is called for every event and on every re-subscribe. It never receives the payload:
 * the row is not an authority, so passing it on would only invite someone to trust it.
 */
export function subscribeToMemberEnrollmentChanges(onSignal: (reason: string) => void): () => void {
  if (!hasSupabaseConfig || !supabase) return () => {};

  let channel: RealtimeChannel | null = null;
  try {
    channel = supabase
      .channel(`waka-member-enrollment-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "loyalty_enrollment_requests" },
        (payload) => onSignal(`realtime:${String(payload?.eventType ?? "unknown")}`),
      )
      .subscribe((status) => {
        // A (re)subscribe means events may have been missed while the socket was down — including
        // an approval that landed between the initial query and the subscription opening. Refetch
        // on every transition into SUBSCRIBED; it is cheap and it closes that window.
        if (status === "SUBSCRIBED") onSignal("subscribed");
      });
  } catch {
    return () => {};
  }

  return () => {
    try {
      void channel?.unsubscribe();
    } catch {
      /* socket already gone */
    }
  };
}
