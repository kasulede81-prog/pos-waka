/**
 * RS-CI-0.2 — optional support ticket is same-shop context only.
 * Mirrors remote_support_request_start ticket checks. Does not authorize Remote Support.
 * Do not require ticket.device_fingerprint to match the selected POS.
 */

export type RemoteSupportTicketBindingInput = {
  shopId: string;
  deviceShopId: string;
  supportRequestId?: string | null;
  ticket: { id: string; shop_id: string | null } | null;
};

export type RemoteSupportTicketBindingResult =
  | { ok: true; attachTicket: boolean; createRow: true }
  | {
      ok: false;
      createRow: false;
      error: "device_shop_mismatch" | "support_request_not_found" | "support_request_shop_mismatch";
    };

export function assertRemoteSupportTicketShopBinding(
  input: RemoteSupportTicketBindingInput,
): RemoteSupportTicketBindingResult {
  if (input.deviceShopId !== input.shopId) {
    return { ok: false, createRow: false, error: "device_shop_mismatch" };
  }

  const ticketId = input.supportRequestId == null ? "" : String(input.supportRequestId).trim();
  if (!ticketId) {
    return { ok: true, attachTicket: false, createRow: true };
  }

  if (!input.ticket || input.ticket.id !== ticketId) {
    return { ok: false, createRow: false, error: "support_request_not_found" };
  }
  if (input.ticket.shop_id !== input.shopId) {
    return { ok: false, createRow: false, error: "support_request_shop_mismatch" };
  }

  return { ok: true, attachTicket: true, createRow: true };
}
