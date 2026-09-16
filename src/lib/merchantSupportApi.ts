import { supabase } from "./supabase";

/**
 * Merchant-facing "Notifications & Support" client API.
 *
 * All reads go through Supabase table selects protected by RLS
 * (merchant_support_tickets / merchant_support_messages / merchant_notifications)
 * so a merchant can never read another shop's data regardless of what the UI sends.
 * All writes go through the SECURITY DEFINER RPCs in migration
 * 20260917003000_merchant_support_center, which re-derive authorization from
 * auth.uid() + user_can_access_shop — never from client-supplied shop scoping alone.
 */

export const SUPPORT_TICKET_CATEGORIES = [
  "account",
  "pos",
  "inventory",
  "sales",
  "payments",
  "customers",
  "staff",
  "printing",
  "sync_offline",
  "technical",
  "other",
] as const;

export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];

export type MerchantTicketStatus =
  | "open"
  | "under_review"
  | "waiting_for_merchant"
  | "resolved"
  | "closed";

export type MerchantSupportTicketRow = {
  id: string;
  ticketNumber: number;
  shopId: string;
  createdByUserId: string;
  subject: string;
  category: SupportTicketCategory;
  description: string;
  status: MerchantTicketStatus;
  priority: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
};

export type MerchantSupportMessageRow = {
  id: string;
  ticketId: string;
  authorUserId: string;
  authorKind: "merchant" | "waka";
  body: string;
  readByMerchantAt: string | null;
  createdAt: string;
};

export type MerchantNotificationType =
  | "financial_issue_received"
  | "financial_issue_under_review"
  | "financial_issue_resolved"
  | "financial_issue_closed"
  | "support_request_received"
  | "support_under_review"
  | "support_waiting_for_you"
  | "support_resolved"
  | "support_closed"
  | "account_security"
  | "system_announcement"
  | "license_announcement"
  | "service_announcement";

export type MerchantNotificationRow = {
  id: string;
  shopId: string;
  userId: string | null;
  type: MerchantNotificationType;
  title: string;
  message: string;
  readAt: string | null;
  relatedTicketId: string | null;
  relatedRequestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type MerchantFinancialCorrectionSummary = {
  id: string;
  status:
    | "submitted"
    | "under_review"
    | "approved"
    | "rejected"
    | "correction_applied"
    | "requires_manual_review";
  saleRef: string;
  productName: string;
  quantity: number | null;
  reason: string;
  createdAt: string;
  updatedAt: string;
};

type RpcResult = { ok?: boolean; error?: string; [key: string]: unknown };

async function rpc<T extends RpcResult>(fn: string, args: Record<string, unknown>): Promise<T | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: error.message };
  const row = data as T | null;
  if (!row || row.ok !== true) return { ok: false, error: row?.error ?? "request_failed" };
  return row;
}

export async function createSupportTicket(input: {
  shopId: string;
  subject: string;
  category: SupportTicketCategory;
  description: string;
}): Promise<{ ok: true; ticketId: string; ticketNumber: number } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true; ticket_id?: string; ticket_number?: number }>(
    "shop_create_support_ticket",
    {
      p_shop_id: input.shopId,
      p_subject: input.subject,
      p_category: input.category,
      p_description: input.description,
    },
  );
  if (!result.ok) return result;
  return { ok: true, ticketId: String(result.ticket_id ?? ""), ticketNumber: Number(result.ticket_number ?? 0) };
}

export async function replySupportTicket(
  ticketId: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true }>("shop_reply_support_ticket", {
    p_ticket_id: ticketId,
    p_body: body,
  });
  if (!result.ok) return result;
  return { ok: true };
}

export async function markTicketMessagesRead(
  ticketId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true }>("shop_mark_ticket_messages_read", { p_ticket_id: ticketId });
  if (!result.ok) return result;
  return { ok: true };
}

export async function markNotificationRead(
  notificationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true }>("shop_mark_notification_read", { p_notification_id: notificationId });
  if (!result.ok) return result;
  return { ok: true };
}

export async function markAllNotificationsRead(
  shopId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await rpc<{ ok: true }>("shop_mark_all_notifications_read", { p_shop_id: shopId });
  if (!result.ok) return result;
  return { ok: true };
}

export async function listMyFinancialCorrectionRequests(
  shopId: string,
): Promise<{ ok: true; requests: MerchantFinancialCorrectionSummary[] } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("shop_list_my_financial_correction_requests", {
    p_shop_id: shopId,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string; requests?: unknown } | null;
  if (!row || row.ok !== true) return { ok: false, error: row?.error ?? "list_failed" };
  const raw = Array.isArray(row.requests) ? row.requests : [];
  const requests: MerchantFinancialCorrectionSummary[] = raw.map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: String(x.id ?? ""),
      status: (x.status as MerchantFinancialCorrectionSummary["status"]) ?? "submitted",
      saleRef: String(x.saleRef ?? ""),
      productName: String(x.productName ?? ""),
      quantity: typeof x.quantity === "number" ? x.quantity : null,
      reason: String(x.reason ?? ""),
      createdAt: String(x.createdAt ?? ""),
      updatedAt: String(x.updatedAt ?? ""),
    };
  });
  return { ok: true, requests };
}

// ---------------------------------------------------------------------------
// RLS-backed reads (server filters by caller; shopId is a hint for indexing only)
// ---------------------------------------------------------------------------

const TICKET_SELECT =
  "id, ticket_number, shop_id, created_by_user_id, subject, category, description, status, priority, created_at, updated_at, last_message_at, resolved_at, closed_at";

function mapTicket(x: Record<string, unknown>): MerchantSupportTicketRow {
  return {
    id: String(x.id ?? ""),
    ticketNumber: Number(x.ticket_number ?? 0),
    shopId: String(x.shop_id ?? ""),
    createdByUserId: String(x.created_by_user_id ?? ""),
    subject: String(x.subject ?? ""),
    category: (x.category as SupportTicketCategory) ?? "other",
    description: String(x.description ?? ""),
    status: (x.status as MerchantTicketStatus) ?? "open",
    priority: String(x.priority ?? "normal"),
    createdAt: String(x.created_at ?? ""),
    updatedAt: String(x.updated_at ?? ""),
    lastMessageAt: String(x.last_message_at ?? ""),
    resolvedAt: x.resolved_at != null ? String(x.resolved_at) : null,
    closedAt: x.closed_at != null ? String(x.closed_at) : null,
  };
}

export async function listSupportTickets(input: {
  shopId: string;
  status?: MerchantTicketStatus | "all";
}): Promise<{ ok: true; tickets: MerchantSupportTicketRow[] } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  let query = supabase
    .from("merchant_support_tickets")
    .select(TICKET_SELECT)
    .eq("shop_id", input.shopId)
    .order("last_message_at", { ascending: false });
  if (input.status && input.status !== "all") {
    query = query.eq("status", input.status);
  }
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  const tickets = (Array.isArray(data) ? data : []).map((x) => mapTicket(x as Record<string, unknown>));
  return { ok: true, tickets };
}

export async function getSupportTicket(
  ticketId: string,
): Promise<{ ok: true; ticket: MerchantSupportTicketRow } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase
    .from("merchant_support_tickets")
    .select(TICKET_SELECT)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "not_found" };
  return { ok: true, ticket: mapTicket(data as Record<string, unknown>) };
}

const MESSAGE_SELECT =
  "id, ticket_id, author_user_id, author_kind, body, read_by_merchant_at, created_at";

export async function listTicketMessages(
  ticketId: string,
): Promise<{ ok: true; messages: MerchantSupportMessageRow[] } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase
    .from("merchant_support_messages")
    .select(MESSAGE_SELECT)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };
  const messages = (Array.isArray(data) ? data : []).map((x) => {
    const m = x as Record<string, unknown>;
    return {
      id: String(m.id ?? ""),
      ticketId: String(m.ticket_id ?? ""),
      authorUserId: String(m.author_user_id ?? ""),
      authorKind: (m.author_kind as "merchant" | "waka") ?? "merchant",
      body: String(m.body ?? ""),
      readByMerchantAt: m.read_by_merchant_at != null ? String(m.read_by_merchant_at) : null,
      createdAt: String(m.created_at ?? ""),
    };
  });
  return { ok: true, messages };
}

const NOTIFICATION_SELECT =
  "id, shop_id, user_id, type, title, message, read_at, related_ticket_id, related_request_id, metadata, created_at";

function mapNotification(x: Record<string, unknown>): MerchantNotificationRow {
  return {
    id: String(x.id ?? ""),
    shopId: String(x.shop_id ?? ""),
    userId: x.user_id != null ? String(x.user_id) : null,
    type: (x.type as MerchantNotificationType) ?? "system_announcement",
    title: String(x.title ?? ""),
    message: String(x.message ?? ""),
    readAt: x.read_at != null ? String(x.read_at) : null,
    relatedTicketId: x.related_ticket_id != null ? String(x.related_ticket_id) : null,
    relatedRequestId: x.related_request_id != null ? String(x.related_request_id) : null,
    metadata: (x.metadata as Record<string, unknown>) ?? {},
    createdAt: String(x.created_at ?? ""),
  };
}

export async function listNotifications(input: {
  shopId: string;
  unreadOnly?: boolean;
  limit?: number;
}): Promise<{ ok: true; notifications: MerchantNotificationRow[] } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  let query = supabase
    .from("merchant_notifications")
    .select(NOTIFICATION_SELECT)
    .eq("shop_id", input.shopId)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 100);
  if (input.unreadOnly) {
    query = query.is("read_at", null);
  }
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  const notifications = (Array.isArray(data) ? data : []).map((x) =>
    mapNotification(x as Record<string, unknown>),
  );
  return { ok: true, notifications };
}

export async function getNotification(
  notificationId: string,
): Promise<{ ok: true; notification: MerchantNotificationRow } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase
    .from("merchant_notifications")
    .select(NOTIFICATION_SELECT)
    .eq("id", notificationId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "not_found" };
  return { ok: true, notification: mapNotification(data as Record<string, unknown>) };
}

/** Server-authoritative attention counts for the Support navigation badge. */
export async function getSupportUnreadCounts(shopId: string): Promise<{
  unreadNotifications: number;
  waitingForYouTickets: number;
  ticketsWithUnreadReplies: number;
}> {
  const empty = { unreadNotifications: 0, waitingForYouTickets: 0, ticketsWithUnreadReplies: 0 };
  if (!supabase || !shopId) return empty;

  const unreadRes = await supabase
    .from("merchant_notifications")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .is("read_at", null);

  const waitingRes = await supabase
    .from("merchant_support_tickets")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("status", "waiting_for_merchant");

  // Tickets with at least one unread WAKA reply — embedded filter counted
  // server-side by PostgREST (RLS applies to the embedded messages too).
  const unreadRepliesRes = await supabase
    .from("merchant_support_tickets")
    .select("id, merchant_support_messages!inner(id)", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("merchant_support_messages.author_kind", "waka")
    .is("merchant_support_messages.read_by_merchant_at", null);

  return {
    unreadNotifications: unreadRes.count ?? 0,
    waitingForYouTickets: waitingRes.count ?? 0,
    ticketsWithUnreadReplies: unreadRepliesRes.count ?? 0,
  };
}
