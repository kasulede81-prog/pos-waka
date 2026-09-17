import { supabase } from "./supabase";

/**
 * Phase 3 — Live Support Session client API.
 *
 * Reads go through RLS-protected table selects; every write goes through the
 * SECURITY DEFINER RPCs in migration 20260917130000_support_phase3_live_sessions,
 * which re-derive authorization from auth.uid() + shop membership /
 * internal role — never from client-supplied scoping.
 *
 * A live session is time-boxed (5–60 min, default 30), single-open-per-ticket,
 * hard-expired server-side, and carries ONLY curated activity labels — never
 * DOM, field values, or amounts. The support session grants the agent no
 * write path into the merchant app.
 */

export type SupportSessionStatus =
  | "requested"
  | "active"
  | "expired"
  | "revoked"
  | "ended";

export type SupportSessionEndedReason =
  | "merchant_stop"
  | "admin_end"
  | "ticket_closed"
  | "expired"
  | "revoked"
  | "declined";

export type SupportSessionRow = {
  id: string;
  ticketId: string;
  shopId: string;
  supportUserId: string | null;
  status: SupportSessionStatus;
  durationMinutes: number;
  requestedBy: string | null;
  requestedByRole: "merchant" | "support";
  approvedBy: string | null;
  createdAt: string;
  approvedAt: string | null;
  expiresAt: string;
  endedAt: string | null;
  endedBy: string | null;
  endedReason: SupportSessionEndedReason | null;
};

export type SupportSessionEventType =
  | "session_requested"
  | "session_approved"
  | "session_started"
  | "route_changed"
  | "page_opened"
  | "record_viewed"
  | "dialog_opened"
  | "session_ended"
  | "revoked"
  | "expired";

export type SupportSessionEventRow = {
  id: number;
  sessionId: string;
  ticketId: string;
  shopId: string;
  supportUserId: string | null;
  eventType: SupportSessionEventType;
  routePath: string | null;
  label: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

/**
 * Curated read-only route allowlist — mirror of
 * public.waka_support_session_allowlist() in the migration. The RPC rejects
 * any route outside this list, so drift here only limits the UI, never
 * widens access.
 */
export type SupportSessionRoute = {
  path: string;
  labelKey: string;
};

export const SUPPORT_SESSION_ROUTES: SupportSessionRoute[] = [
  { path: "/office", labelKey: "supportSessionRouteOffice" },
  { path: "/stock", labelKey: "supportSessionRouteStock" },
  { path: "/customers", labelKey: "supportSessionRouteCustomers" },
  { path: "/cash-expenses", labelKey: "supportSessionRouteExpenses" },
  { path: "/reports", labelKey: "supportSessionRouteReports" },
  { path: "/receipts", labelKey: "supportSessionRouteReceipts" },
  { path: "/settings", labelKey: "supportSessionRouteSettings" },
];

export const SUPPORT_SESSION_DEFAULT_MINUTES = 30;
export const SUPPORT_SESSION_MIN_MINUTES = 5;
export const SUPPORT_SESSION_MAX_MINUTES = 60;

export function isSupportSessionOpen(status: SupportSessionStatus): boolean {
  return status === "requested" || status === "active";
}

/** Whole seconds until hard expiry; negative once past. */
export function supportSessionSecondsRemaining(session: {
  expiresAt: string;
}): number {
  const ms = new Date(session.expiresAt).getTime() - Date.now();
  return Math.floor(ms / 1000);
}

type RpcResult = { ok?: boolean; error?: string; [key: string]: unknown };

async function rpc<T extends RpcResult>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: error.message };
  const row = data as T | null;
  if (!row || row.ok !== true) return { ok: false, error: row?.error ?? "request_failed" };
  return row;
}

function mapSession(x: Record<string, unknown>): SupportSessionRow {
  return {
    id: String(x.id ?? ""),
    ticketId: String(x.ticket_id ?? ""),
    shopId: String(x.shop_id ?? ""),
    supportUserId: x.support_user_id != null ? String(x.support_user_id) : null,
    status: (x.status as SupportSessionStatus) ?? "requested",
    durationMinutes: Number(x.duration_minutes ?? 30),
    requestedBy: x.requested_by != null ? String(x.requested_by) : null,
    requestedByRole: (x.requested_by_role as "merchant" | "support") ?? "merchant",
    approvedBy: x.approved_by != null ? String(x.approved_by) : null,
    createdAt: String(x.created_at ?? ""),
    approvedAt: x.approved_at != null ? String(x.approved_at) : null,
    expiresAt: String(x.expires_at ?? ""),
    endedAt: x.ended_at != null ? String(x.ended_at) : null,
    endedBy: x.ended_by != null ? String(x.ended_by) : null,
    endedReason: (x.ended_reason as SupportSessionEndedReason | null) ?? null,
  };
}

function mapEvent(x: Record<string, unknown>): SupportSessionEventRow {
  return {
    id: Number(x.id ?? 0),
    sessionId: String(x.session_id ?? ""),
    ticketId: String(x.ticket_id ?? ""),
    shopId: String(x.shop_id ?? ""),
    supportUserId: x.support_user_id != null ? String(x.support_user_id) : null,
    eventType: (x.event_type as SupportSessionEventType) ?? "page_opened",
    routePath: x.route_path != null ? String(x.route_path) : null,
    label: String(x.label ?? ""),
    metadata: (x.metadata as Record<string, unknown>) ?? {},
    createdAt: String(x.created_at ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Writes (RPC-gated)
// ---------------------------------------------------------------------------

export async function requestSupportSession(
  ticketId: string,
  durationMinutes: number = SUPPORT_SESSION_DEFAULT_MINUTES,
): Promise<{ ok: true; session: SupportSessionRow } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true; session?: Record<string, unknown> }>(
    "waka_request_support_session",
    { p_ticket_id: ticketId, p_duration_minutes: durationMinutes },
  );
  if (!result.ok) return result;
  return { ok: true, session: mapSession(result.session ?? {}) };
}

/** Internal admin asks the merchant for a live session (merchant must allow). */
export async function adminRequestSupportSession(
  ticketId: string,
  durationMinutes: number = SUPPORT_SESSION_DEFAULT_MINUTES,
): Promise<{ ok: true; session: SupportSessionRow } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true; session?: Record<string, unknown> }>(
    "waka_admin_request_support_session",
    { p_ticket_id: ticketId, p_duration_minutes: durationMinutes },
  );
  if (!result.ok) return result;
  return { ok: true, session: mapSession(result.session ?? {}) };
}

/** Merchant allows or declines a support-initiated request. */
export async function merchantRespondSupportSession(
  sessionId: string,
  approve: boolean,
): Promise<{ ok: true; session: SupportSessionRow } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true; session?: Record<string, unknown> }>(
    "waka_merchant_respond_support_session",
    { p_session_id: sessionId, p_approve: approve },
  );
  if (!result.ok) return result;
  return { ok: true, session: mapSession(result.session ?? {}) };
}

export async function respondSupportSession(
  sessionId: string,
  approve: boolean,
  durationMinutes?: number,
): Promise<{ ok: true; session: SupportSessionRow } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true; session?: Record<string, unknown> }>(
    "waka_respond_support_session",
    {
      p_session_id: sessionId,
      p_approve: approve,
      p_duration_minutes: durationMinutes ?? null,
    },
  );
  if (!result.ok) return result;
  return { ok: true, session: mapSession(result.session ?? {}) };
}

/** Merchant-side instant kill (requested or active). */
export async function revokeSupportSession(
  sessionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true }>("waka_revoke_support_session", {
    p_session_id: sessionId,
  });
  if (!result.ok) return result;
  return { ok: true };
}

/** Admin-side graceful end of an active session. */
export async function endSupportSession(
  sessionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true }>("waka_end_support_session", {
    p_session_id: sessionId,
  });
  if (!result.ok) return result;
  return { ok: true };
}

/**
 * Curated activity event. Callable only by the session owner (the agent)
 * while the session is active and unexpired; the RPC caps the label, clamps
 * metadata to short scalars, and rejects routes outside the allowlist.
 */
export async function emitSupportSessionEvent(
  sessionId: string,
  eventType: SupportSessionEventType,
  label: string,
  routePath?: string | null,
  metadata?: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true }>("waka_support_session_event", {
    p_session_id: sessionId,
    p_event_type: eventType,
    p_label: label,
    p_route_path: routePath ?? null,
    p_metadata: metadata ?? {},
  });
  if (!result.ok) return result;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reads (RLS-backed: server filters by caller)
// ---------------------------------------------------------------------------

export async function getTicketSession(
  ticketId: string,
): Promise<{ ok: true; session: SupportSessionRow | null } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true; session?: Record<string, unknown> | null }>(
    "waka_get_ticket_session",
    { p_ticket_id: ticketId },
  );
  if (!result.ok) return result;
  return {
    ok: true,
    session: result.session ? mapSession(result.session) : null,
  };
}

/** Open sessions for a shop (merchant banner). shopId is an index hint only. */
export async function fetchShopOpenSessions(
  shopId: string,
): Promise<{ ok: true; sessions: SupportSessionRow[] } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase
    .from("merchant_support_sessions")
    .select(
      "id, ticket_id, shop_id, support_user_id, status, duration_minutes, requested_by, requested_by_role, approved_by, created_at, approved_at, expires_at, ended_at, ended_by, ended_reason",
    )
    .eq("shop_id", shopId)
    .in("status", ["requested", "active"])
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, sessions: (data ?? []).map((x) => mapSession(x as Record<string, unknown>)) };
}

/** Activity feed for one session (newest first, capped). */
export async function fetchSessionEvents(
  sessionId: string,
  limit = 50,
): Promise<{ ok: true; events: SupportSessionEventRow[] } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase
    .from("merchant_support_session_events")
    .select(
      "id, session_id, ticket_id, shop_id, support_user_id, event_type, route_path, label, metadata, created_at",
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: error.message };
  return { ok: true, events: (data ?? []).map((x) => mapEvent(x as Record<string, unknown>)) };
}

/** Latest route event inside a session feed, for "currently viewing". */
export function latestRouteEvent(
  events: SupportSessionEventRow[],
): SupportSessionEventRow | null {
  return events.find((e) => e.routePath != null) ?? null;
}
