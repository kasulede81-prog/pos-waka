import { supabase } from "./supabase";
import {
  listTicketAttachments,
  type MerchantSupportAttachmentRow,
  type UploadedAttachment,
} from "./supportAttachments";

export type { MerchantSupportAttachmentRow } from "./supportAttachments";

/** All attachments of a ticket (internal read policy). */
export async function fetchMerchantTicketAttachments(
  ticketId: string,
): Promise<MerchantSupportAttachmentRow[]> {
  const r = await listTicketAttachments(ticketId);
  return r.ok ? r.attachments : [];
}

/**
 * Internal-operations console for the Phase 1 merchant Support Center
 * (merchant_support_tickets / merchant_support_messages / merchant_notifications).
 *
 * No new RPCs: internal staff act through the internal RLS policies created in
 * migration 20260917003000 (super_admin / support_admin), exactly like the
 * legacy support_requests queue does today.
 */

export type MerchantTicketStatus = "open" | "under_review" | "waiting_for_merchant" | "resolved" | "closed";

export type MerchantTicketQueueRow = {
  id: string;
  ticketNumber: number;
  shopId: string;
  subject: string;
  category: string;
  status: MerchantTicketStatus;
  priority: string;
  description: string;
  createdAt: string;
  lastMessageAt: string;
  shopName: string | null;
  shopDistrict: string | null;
  shopPhoneE164: string | null;
  unreadWakaThread: boolean;
};

export type MerchantTicketMessageRow = {
  id: string;
  authorKind: "merchant" | "waka";
  body: string;
  createdAt: string;
};

export type MerchantTicketFilter = "attention" | "waiting" | "done" | "all";

const ATTENTION_STATUSES: MerchantTicketStatus[] = ["open", "under_review"];
const DONE_STATUSES: MerchantTicketStatus[] = ["resolved", "closed"];

export function merchantTicketMatchesFilter(status: MerchantTicketStatus, filter: MerchantTicketFilter): boolean {
  switch (filter) {
    case "attention":
      return ATTENTION_STATUSES.includes(status);
    case "waiting":
      return status === "waiting_for_merchant";
    case "done":
      return DONE_STATUSES.includes(status);
    case "all":
      return true;
  }
}

export function merchantTicketReference(ticketNumber: number): string {
  return `WAKA-${String(ticketNumber).padStart(4, "0")}`;
}

export function merchantTicketStatusNotificationType(
  status: MerchantTicketStatus,
): "support_under_review" | "support_resolved" | "support_closed" | null {
  switch (status) {
    case "under_review":
      return "support_under_review";
    case "resolved":
      return "support_resolved";
    case "closed":
      return "support_closed";
    default:
      return null;
  }
}

type TicketJoinRow = {
  id: string;
  ticket_number: number;
  shop_id: string;
  subject: string;
  category: string;
  status: MerchantTicketStatus;
  priority: string;
  description: string;
  created_at: string;
  last_message_at: string;
  shops: { name: string | null; district: string | null; phone_e164: string | null }[] | { name: string | null; district: string | null; phone_e164: string | null } | null;
};

function mapTicketRow(row: TicketJoinRow): MerchantTicketQueueRow {
  const shop = Array.isArray(row.shops) ? row.shops[0] : row.shops;
  return {
    id: row.id,
    ticketNumber: Number(row.ticket_number),
    shopId: row.shop_id,
    subject: row.subject,
    category: row.category,
    status: row.status,
    priority: row.priority,
    description: row.description,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    shopName: shop?.name ?? null,
    shopDistrict: shop?.district ?? null,
    shopPhoneE164: shop?.phone_e164 ?? null,
    unreadWakaThread: false,
  };
}

export async function fetchMerchantTicketQueue(filter: MerchantTicketFilter, limit = 100): Promise<MerchantTicketQueueRow[]> {
  if (!supabase) return [];
  let query = supabase
    .from("merchant_support_tickets")
    .select("id, ticket_number, shop_id, subject, category, status, priority, description, created_at, last_message_at, shops(name, district, phone_e164)")
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (filter === "attention") query = query.in("status", ATTENTION_STATUSES);
  else if (filter === "waiting") query = query.eq("status", "waiting_for_merchant");
  else if (filter === "done") query = query.in("status", DONE_STATUSES);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as TicketJoinRow[]).map(mapTicketRow);
}

export async function fetchMerchantTicketMessages(ticketId: string): Promise<MerchantTicketMessageRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("merchant_support_messages")
    .select("id, author_kind, body, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as { id: string; author_kind: "merchant" | "waka"; body: string; created_at: string }[]).map((m) => ({
    id: m.id,
    authorKind: m.author_kind,
    body: m.body,
    createdAt: m.created_at,
  }));
}

async function insertTicketNotification(input: {
  shopId: string;
  type: string;
  title: string;
  message: string;
  relatedTicketId: string;
}): Promise<void> {
  if (!supabase) return;
  await supabase.from("merchant_notifications").insert({
    shop_id: input.shopId,
    user_id: null,
    type: input.type,
    title: input.title,
    message: input.message,
    related_ticket_id: input.relatedTicketId,
  });
}

export async function replyToMerchantTicket(input: {
  ticketId: string;
  shopId: string;
  ticketNumber: number;
  subject: string;
  body: string;
  attachments?: UploadedAttachment[];
}): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const body = input.body.trim();
  const attachments = input.attachments ?? [];
  if (!body && attachments.length === 0) return { ok: false, message: "Reply is empty" };
  // author_user_id references auth.users — use the signed-in admin's auth id,
  // never the internal_admins row id.
  const { data: sessionData } = await supabase.auth.getSession();
  const adminUserId = sessionData?.session?.user?.id ?? null;
  if (!adminUserId) return { ok: false, message: "Not signed in" };
  const { data: inserted, error: msgErr } = await supabase
    .from("merchant_support_messages")
    .insert({
      ticket_id: input.ticketId,
      author_user_id: adminUserId,
      author_kind: "waka",
      body,
    })
    .select("id")
    .single();
  if (msgErr) return { ok: false, message: msgErr.message };
  const messageId = String(inserted?.id ?? "");
  if (attachments.length > 0 && messageId) {
    const { error: attErr } = await supabase.from("merchant_support_attachments").insert(
      attachments.map((a) => ({
        message_id: messageId,
        ticket_id: input.ticketId,
        shop_id: input.shopId,
        storage_path: a.storagePath,
        original_filename: a.originalFilename,
        mime_type: a.mimeType,
        file_size_bytes: a.fileSizeBytes,
        attachment_kind: a.attachmentKind,
      })),
    );
    // A metadata failure must not silently drop the reply text, but the
    // attachments are unusable without metadata — surface it.
    if (attErr) return { ok: false, message: attErr.message };
  }
  const { error: tkErr } = await supabase
    .from("merchant_support_tickets")
    .update({ status: "waiting_for_merchant", last_message_at: new Date().toISOString() })
    .eq("id", input.ticketId);
  if (tkErr) return { ok: false, message: tkErr.message };
  const ref = merchantTicketReference(input.ticketNumber);
  try {
    await insertTicketNotification({
      shopId: input.shopId,
      type: "support_waiting_for_you",
      title: "Reply from WAKA support",
      message: `We replied to your support request ${ref} ("${input.subject}"). Open it to read our response.`,
      relatedTicketId: input.ticketId,
    });
  } catch {
    // Notification is best-effort: the reply itself is already persisted.
  }
  return { ok: true };
}

export async function setMerchantTicketStatus(input: {
  ticketId: string;
  shopId: string;
  ticketNumber: number;
  subject: string;
  status: MerchantTicketStatus;
}): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const patch: Record<string, string | null> = { status: input.status };
  if (input.status === "resolved") patch.resolved_at = new Date().toISOString();
  if (input.status === "closed") patch.closed_at = new Date().toISOString();
  const { error } = await supabase.from("merchant_support_tickets").update(patch).eq("id", input.ticketId);
  if (error) return { ok: false, message: error.message };
  const type = merchantTicketStatusNotificationType(input.status);
  if (type) {
    const ref = merchantTicketReference(input.ticketNumber);
    const label =
      input.status === "under_review" ? "is now under review" : input.status === "resolved" ? "has been resolved" : "has been closed";
    try {
      await insertTicketNotification({
        shopId: input.shopId,
        type,
        title:
          input.status === "under_review"
            ? "Support request under review"
            : input.status === "resolved"
              ? "Support request resolved"
              : "Support request closed",
        message: `Your support request ${ref} ("${input.subject}") ${label}.`,
        relatedTicketId: input.ticketId,
      });
    } catch {
      // Best-effort notification; status change is already persisted.
    }
  }
  return { ok: true };
}
