import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSupportTicket,
  getNotification,
  getSupportTicket,
  getSupportUnreadCounts,
  listMyFinancialCorrectionRequests,
  listNotifications,
  listSupportTickets,
  listTicketMessages,
  markAllNotificationsRead,
  markNotificationRead,
  markTicketMessagesRead,
  replySupportTicket,
  type MerchantTicketStatus,
  type SupportTicketCategory,
} from "../lib/merchantSupportApi";

const STALE_MS = 30_000;
const BADGE_REFETCH_MS = 60_000;

function key(parts: unknown[]) {
  return ["merchant-support", ...parts];
}

/** Server-authoritative unread/attention counts for the Support navigation badge. */
export function useSupportUnreadCounts(shopId: string | null, enabled = true) {
  return useQuery({
    queryKey: key(["unread-counts", shopId]),
    queryFn: () => getSupportUnreadCounts(shopId as string),
    enabled: Boolean(shopId) && enabled,
    refetchInterval: BADGE_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: STALE_MS,
    placeholderData: (prev) => prev,
  });
}

export function useSupportTicketList(
  shopId: string | null,
  status: MerchantTicketStatus | "all",
  enabled = true,
) {
  return useQuery({
    queryKey: key(["tickets", shopId, status]),
    queryFn: () => listSupportTickets({ shopId: shopId as string, status }),
    enabled: Boolean(shopId) && enabled,
    staleTime: STALE_MS,
  });
}

export function useSupportTicket(ticketId: string | null) {
  return useQuery({
    queryKey: key(["ticket", ticketId]),
    queryFn: () => getSupportTicket(ticketId as string),
    enabled: Boolean(ticketId),
    staleTime: STALE_MS,
  });
}

export function useTicketMessages(ticketId: string | null) {
  return useQuery({
    queryKey: key(["ticket-messages", ticketId]),
    queryFn: () => listTicketMessages(ticketId as string),
    enabled: Boolean(ticketId),
    staleTime: STALE_MS,
  });
}

export function useNotificationList(shopId: string | null, unreadOnly = false, limit?: number) {
  return useQuery({
    queryKey: key(["notifications", shopId, unreadOnly, limit ?? 100]),
    queryFn: () => listNotifications({ shopId: shopId as string, unreadOnly, limit }),
    enabled: Boolean(shopId),
    staleTime: STALE_MS,
  });
}

export function useNotification(notificationId: string | null) {
  return useQuery({
    queryKey: key(["notification", notificationId]),
    queryFn: () => getNotification(notificationId as string),
    enabled: Boolean(notificationId),
    staleTime: STALE_MS,
  });
}

export function useMyFinancialCorrections(shopId: string | null, enabled = true) {
  return useQuery({
    queryKey: key(["financial-corrections", shopId]),
    queryFn: () => listMyFinancialCorrectionRequests(shopId as string),
    enabled: Boolean(shopId) && enabled,
    staleTime: STALE_MS,
  });
}

export function useCreateSupportTicket(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { subject: string; category: SupportTicketCategory; description: string }) =>
      createSupportTicket({ shopId: shopId as string, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(["tickets", shopId]) });
      void qc.invalidateQueries({ queryKey: key(["unread-counts", shopId]) });
    },
  });
}

export function useReplySupportTicket(shopId: string | null, ticketId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => replySupportTicket(ticketId as string, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(["ticket-messages", ticketId]) });
      void qc.invalidateQueries({ queryKey: key(["ticket", ticketId]) });
      void qc.invalidateQueries({ queryKey: key(["tickets", shopId]) });
    },
  });
}

/** Marks all WAKA messages of a ticket read once the merchant opens the conversation. */
export function useMarkTicketMessagesRead(shopId: string | null, ticketId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markTicketMessagesRead(ticketId as string),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(["ticket-messages", ticketId]) });
      void qc.invalidateQueries({ queryKey: key(["tickets", shopId]) });
      void qc.invalidateQueries({ queryKey: key(["unread-counts", shopId]) });
    },
  });
}

export function useMarkNotificationRead(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(["notifications", shopId]) });
      void qc.invalidateQueries({ queryKey: key(["unread-counts", shopId]) });
    },
  });
}

export function useMarkAllNotificationsRead(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(shopId as string),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(["notifications", shopId]) });
      void qc.invalidateQueries({ queryKey: key(["unread-counts", shopId]) });
    },
  });
}
