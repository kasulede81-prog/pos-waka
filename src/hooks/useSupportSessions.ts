import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminRequestSupportSession,
  emitSupportSessionEvent,
  endSupportSession,
  fetchSessionEvents,
  fetchShopOpenSessions,
  getTicketSession,
  merchantRespondSupportSession,
  requestSupportSession,
  respondSupportSession,
  revokeSupportSession,
  type SupportSessionEventType,
} from "../lib/supportSessions";

const STALE_MS = 15_000;

function key(parts: unknown[]) {
  return ["support-sessions", ...parts];
}

/** The open (requested/active) session for one ticket, if any. */
export function useTicketSupportSession(ticketId: string | null) {
  return useQuery({
    queryKey: key(["ticket", ticketId]),
    queryFn: () => getTicketSession(ticketId as string),
    enabled: Boolean(ticketId),
    staleTime: STALE_MS,
  });
}

/** Open sessions for the shop (merchant AppShell banner). */
export function useShopOpenSessions(shopId: string | null) {
  return useQuery({
    queryKey: key(["shop-open", shopId]),
    queryFn: () => fetchShopOpenSessions(shopId as string),
    enabled: Boolean(shopId),
    staleTime: STALE_MS,
  });
}

/** Activity feed for one session (merchant banner + admin console). */
export function useSessionEvents(sessionId: string | null, enabled = true) {
  return useQuery({
    queryKey: key(["events", sessionId]),
    queryFn: () => fetchSessionEvents(sessionId as string),
    enabled: Boolean(sessionId) && enabled,
    staleTime: STALE_MS,
  });
}

export function useRequestSupportSession(shopId: string | null, ticketId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (durationMinutes: number) => requestSupportSession(ticketId as string, durationMinutes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(["ticket", ticketId]) });
      void qc.invalidateQueries({ queryKey: key(["shop-open", shopId]) });
    },
  });
}

/** Internal admin asks the merchant for a live session. */
export function useAdminRequestSupportSession(ticketId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (durationMinutes: number) => adminRequestSupportSession(ticketId as string, durationMinutes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(["ticket", ticketId]) });
      void qc.invalidateQueries({ queryKey: key([]) });
    },
  });
}

/** Merchant allows or declines a support-initiated request. */
export function useMerchantRespondSupportSession(shopId: string | null, ticketId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sessionId: string; approve: boolean }) =>
      merchantRespondSupportSession(input.sessionId, input.approve),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(["ticket", ticketId]) });
      void qc.invalidateQueries({ queryKey: key(["shop-open", shopId]) });
    },
  });
}

export function useRespondSupportSession(ticketId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sessionId: string; approve: boolean; durationMinutes?: number }) =>
      respondSupportSession(input.sessionId, input.approve, input.durationMinutes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(["ticket", ticketId]) });
      void qc.invalidateQueries({ queryKey: key(["events", ticketId]) });
      void qc.invalidateQueries({ queryKey: key([]) });
    },
  });
}

export function useRevokeSupportSession(shopId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => revokeSupportSession(sessionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(["shop-open", shopId]) });
      void qc.invalidateQueries({ queryKey: key([]) });
    },
  });
}

export function useEndSupportSession(ticketId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => endSupportSession(sessionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(["ticket", ticketId]) });
      void qc.invalidateQueries({ queryKey: key([]) });
    },
  });
}

/** Curated activity event — admin console only (RPC gates on session owner). */
export function useEmitSupportSessionEvent(sessionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      eventType: SupportSessionEventType;
      label: string;
      routePath?: string | null;
      metadata?: Record<string, unknown>;
    }) =>
      emitSupportSessionEvent(sessionId as string, input.eventType, input.label, input.routePath, input.metadata),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(["events", sessionId]) });
    },
  });
}
