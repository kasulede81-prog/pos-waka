import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 2.5 realtime contract tests with a mocked supabase client.
 * What matters: one channel per subscription, RLS-scoped filters on every
 * binding, no global wildcard subscriptions, and cleanup (removeChannel) so
 * navigation between tickets never leaks or duplicates subscriptions.
 */

type Handler = { config: Record<string, unknown>; callback: (payload: unknown) => void };

const channels: Array<{ name: string; handlers: Handler[]; subscribed: boolean; removed: boolean }> = [];

function makeApi(entry: (typeof channels)[number]) {
  const api = {
    on: (_event: string, config: Record<string, unknown>, callback: (p: unknown) => void) => {
      entry.handlers.push({ config, callback });
      return api;
    },
    subscribe: () => {
      entry.subscribed = true;
      // Tag the returned channel handle so removeChannel can find the entry.
      return Object.assign(api, { __name: entry.name });
    },
  };
  return api;
}

vi.mock("./supabase", () => ({
  supabase: {
    channel: (name: string) => {
      const entry = { name, handlers: [] as Handler[], subscribed: false, removed: false };
      channels.push(entry);
      return makeApi(entry);
    },
    removeChannel: async (ch: unknown) => {
      const entry = channels.find((c) => c.name === (ch as { __name?: string }).__name);
      if (entry) entry.removed = true;
      return "ok";
    },
  },
  hasSupabaseConfig: true,
}));

// The mocked channel objects are tagged with their name in subscribe() so
// removeChannel can mark the right entry as removed.

import {
  subscribeAdminTicketFeed,
  subscribeAdminTicketThread,
  subscribeShopSupport,
  subscribeSupportTicket,
} from "./supportRealtime";

describe("subscribeSupportTicket", () => {
  beforeEach(() => {
    channels.length = 0;
  });

  it("creates one subscribed channel with ticket-scoped, RLS-backed filters", () => {
    const onMessage = vi.fn();
    const onTicket = vi.fn();
    subscribeSupportTicket("ticket-123", { onMessageInserted: onMessage, onTicketUpdated: onTicket });
    expect(channels).toHaveLength(1);
    const entry = channels[0];
    expect(entry.name).toContain("ticket-123");
    expect(entry.subscribed).toBe(true);
    const configs = entry.handlers.map((h) => h.config);
    expect(configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "INSERT", table: "merchant_support_messages", filter: "ticket_id=eq.ticket-123" }),
        expect.objectContaining({ event: "UPDATE", table: "merchant_support_tickets", filter: "id=eq.ticket-123" }),
      ]),
    );
    // No global wildcard subscription may ever exist.
    for (const c of configs) {
      expect(c.filter).toBeTruthy();
      expect(String(c.filter)).toContain("eq.");
    }
  });

  it("dispatches inserted rows to the message handler", () => {
    const onMessage = vi.fn();
    subscribeSupportTicket("ticket-123", { onMessageInserted: onMessage });
    const insertHandler = channels[0].handlers.find(
      (h) => h.config.table === "merchant_support_messages",
    );
    insertHandler?.callback({ new: { id: "m1", body: "hello" } });
    expect(onMessage).toHaveBeenCalledWith({ id: "m1", body: "hello" });
  });

  it("unsubscribe removes the channel (no leaks across navigation)", () => {
    const unsubscribe = subscribeSupportTicket("ticket-abc", {});
    expect(channels[0].removed).toBe(false);
    unsubscribe();
    expect(channels[0].removed).toBe(true);
  });
});

describe("subscribeShopSupport", () => {
  beforeEach(() => {
    channels.length = 0;
  });

  it("scopes every binding to the shop id", () => {
    const onEvent = vi.fn();
    subscribeShopSupport("shop-9", onEvent);
    expect(channels).toHaveLength(1);
    const configs = channels[0].handlers.map((h) => h.config);
    expect(configs).toHaveLength(6);
    const tables = configs.map((c) => `${c.event}:${c.table}`);
    expect(tables).toEqual(
      expect.arrayContaining([
        "INSERT:merchant_support_tickets",
        "UPDATE:merchant_support_tickets",
        "INSERT:merchant_notifications",
        "UPDATE:merchant_notifications",
        "INSERT:merchant_support_messages",
        "UPDATE:merchant_support_messages",
      ]),
    );
    for (const c of configs) {
      expect(String(c.filter)).toBe("shop_id=eq.shop-9");
    }
  });

  it("fires the callback for shop events and stops after unsubscribe", () => {
    const onEvent = vi.fn();
    const unsubscribe = subscribeShopSupport("shop-9", onEvent);
    channels[0].handlers[0].callback({ new: {} });
    expect(onEvent).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(channels[0].removed).toBe(true);
  });
});

describe("subscribeAdminTicketFeed", () => {
  beforeEach(() => {
    channels.length = 0;
  });

  it("listens for ticket inserts and updates only (queue nudge)", () => {
    const onQueue = vi.fn();
    const unsubscribe = subscribeAdminTicketFeed(onQueue);
    expect(channels).toHaveLength(1);
    const configs = channels[0].handlers.map((h) => h.config);
    expect(configs).toEqual([
      expect.objectContaining({ event: "INSERT", table: "merchant_support_tickets" }),
      expect.objectContaining({ event: "UPDATE", table: "merchant_support_tickets" }),
    ]);
    channels[0].handlers[0].callback({});
    expect(onQueue).toHaveBeenCalled();
    unsubscribe();
    expect(channels[0].removed).toBe(true);
  });
});

describe("subscribeAdminTicketThread", () => {
  beforeEach(() => {
    channels.length = 0;
  });

  it("scopes the thread channel to the ticket and cleans up", () => {
    const onMessage = vi.fn();
    const unsubscribe = subscribeAdminTicketThread("ticket-77", { onMessageInserted: onMessage });
    expect(channels[0].name).toContain("ticket-77");
    const configs = channels[0].handlers.map((h) => h.config);
    expect(configs).toEqual([
      expect.objectContaining({ event: "INSERT", table: "merchant_support_messages", filter: "ticket_id=eq.ticket-77" }),
      expect.objectContaining({ event: "UPDATE", table: "merchant_support_tickets", filter: "id=eq.ticket-77" }),
    ]);
    unsubscribe();
    expect(channels[0].removed).toBe(true);
  });
});
