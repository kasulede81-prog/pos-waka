import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

/**
 * Phase 2.5 Supabase Realtime wiring for the merchant Support Center.
 *
 * Security model: postgres_changes events are authorized by Postgres RLS with the
 * SUBSCRIBER'S JWT — there is deliberately no global `merchant_support_messages:*`
 * subscription. Merchant channels always carry an exact `shop_id` / `ticket_id`
 * filter, and RLS drops anything the caller could not SELECT anyway.
 *
 * Lifecycle model: every hook owns exactly one channel per mounted instance
 * (unique instance id), removes it on unmount, and re-subscribes cleanly after
 * navigation. React Query invalidation (never blind appends) keeps the UI
 * authoritative; optimistic appends, where used, dedupe by stable message id.
 */

function instanceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type Unsubscribe = () => void;

/**
 * One ticket conversation: new messages + ticket row (status) changes.
 * Plain function (testable); the hook below just wires it into React lifecycle.
 */
export function subscribeSupportTicket(
  ticketId: string,
  handlers: {
    onMessageInserted?: (row: Record<string, unknown>) => void;
    onTicketUpdated?: (row: Record<string, unknown>) => void;
  },
): Unsubscribe {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`support-ticket-${ticketId}-${instanceId()}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "merchant_support_messages",
        filter: `ticket_id=eq.${ticketId}`,
      },
      (payload) => handlers.onMessageInserted?.(payload.new as Record<string, unknown>),
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "merchant_support_tickets",
        filter: `id=eq.${ticketId}`,
      },
      (payload) => handlers.onTicketUpdated?.(payload.new as Record<string, unknown>),
    )
    .subscribe();
  return () => {
    if (supabase) void supabase.removeChannel(channel);
  };
}

export function useSupportTicketRealtime(ticketId: string | null, handlers: {
  onMessageInserted?: (row: Record<string, unknown>) => void;
  onTicketUpdated?: (row: Record<string, unknown>) => void;
}): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!ticketId) return;
    return subscribeSupportTicket(ticketId, {
      onMessageInserted: (row) => handlersRef.current.onMessageInserted?.(row),
      onTicketUpdated: (row) => handlersRef.current.onTicketUpdated?.(row),
    });
  }, [ticketId]);
}

/**
 * Shop-scoped surface (ticket lists, notification feeds, unread badges):
 * ticket inserts/updates, notification inserts/updates, and message
 * inserts/read-state updates for this shop only.
 */
export function subscribeShopSupport(shopId: string, onEvent: () => void): Unsubscribe {
  if (!supabase) return () => {};
  const base = { schema: "public" as const };
  const channel = supabase
    .channel(`support-shop-${shopId}-${instanceId()}`)
    .on("postgres_changes", { ...base, event: "INSERT", table: "merchant_support_tickets", filter: `shop_id=eq.${shopId}` }, onEvent)
    .on("postgres_changes", { ...base, event: "UPDATE", table: "merchant_support_tickets", filter: `shop_id=eq.${shopId}` }, onEvent)
    .on("postgres_changes", { ...base, event: "INSERT", table: "merchant_notifications", filter: `shop_id=eq.${shopId}` }, onEvent)
    .on("postgres_changes", { ...base, event: "UPDATE", table: "merchant_notifications", filter: `shop_id=eq.${shopId}` }, onEvent)
    .on("postgres_changes", { ...base, event: "INSERT", table: "merchant_support_messages", filter: `shop_id=eq.${shopId}` }, onEvent)
    .on("postgres_changes", { ...base, event: "UPDATE", table: "merchant_support_messages", filter: `shop_id=eq.${shopId}` }, onEvent)
    .subscribe();
  return () => {
    if (supabase) void supabase.removeChannel(channel);
  };
}

export function useShopSupportRealtime(shopId: string | null, onEvent: () => void): void {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!shopId) return;
    return subscribeShopSupport(shopId, () => callbackRef.current());
  }, [shopId]);
}

/**
 * Internal WAKA console: any new/updated ticket anywhere (RLS keeps this
 * internal-only) nudges the queue; the expanded ticket gets its own channel for
 * messages and status.
 */
export function subscribeAdminTicketFeed(onQueueChanged: () => void): Unsubscribe {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`support-admin-feed-${instanceId()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "merchant_support_tickets" }, onQueueChanged)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "merchant_support_tickets" }, onQueueChanged)
    .subscribe();
  return () => {
    if (supabase) void supabase.removeChannel(channel);
  };
}

export function useAdminTicketFeedRealtime(onQueueChanged: () => void): void {
  const callbackRef = useRef(onQueueChanged);
  callbackRef.current = onQueueChanged;

  useEffect(() => subscribeAdminTicketFeed(() => callbackRef.current()), []);
}

export function subscribeAdminTicketThread(
  ticketId: string,
  handlers: { onMessageInserted?: () => void; onTicketUpdated?: () => void },
): Unsubscribe {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`support-admin-thread-${ticketId}-${instanceId()}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "merchant_support_messages", filter: `ticket_id=eq.${ticketId}` },
      () => handlers.onMessageInserted?.(),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "merchant_support_tickets", filter: `id=eq.${ticketId}` },
      () => handlers.onTicketUpdated?.(),
    )
    .subscribe();
  return () => {
    if (supabase) void supabase.removeChannel(channel);
  };
}

export function useAdminTicketThreadRealtime(
  ticketId: string | null,
  handlers: { onMessageInserted?: () => void; onTicketUpdated?: () => void },
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!ticketId) return;
    return subscribeAdminTicketThread(ticketId, {
      onMessageInserted: () => handlersRef.current.onMessageInserted?.(),
      onTicketUpdated: () => handlersRef.current.onTicketUpdated?.(),
    });
  }, [ticketId]);
}

/** Tiny shared debouncer for realtime-driven reloads. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const timerRef = useRef<number | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);
  return (...args: A) => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => fnRef.current(...args), ms);
  };
}
