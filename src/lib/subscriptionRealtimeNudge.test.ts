import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The property under test is NOT "it refreshes when the plan changes". It is that REALTIME IS
 * NEVER AN AUTHORITY here: the channel may only ever say "something changed", and it may never
 * put a row in front of a caller who could mistake it for the plan. The assertions that carry
 * that weight are the first two — the callback is handed a reason and nothing else, so there is
 * no payload for a caller to apply.
 */

const removeChannel = vi.fn();
const channelTopics: string[] = [];
const tableHandlers = new Map<string, (payload?: unknown) => void>();
let statusHandler: ((status: string) => void) | null = null;
let channelThrows = false;
let onThrows = false;

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    channel: (topic: string) => {
      if (channelThrows) throw new Error("channel unavailable");
      channelTopics.push(topic);
      const ch = {
        on: (_evt: string, opts: { table: string }, cb: (payload?: unknown) => void) => {
          if (onThrows) throw new Error("listener registration failed");
          tableHandlers.set(opts.table, cb);
          return ch;
        },
        subscribe: (cb: (status: string) => void) => {
          statusHandler = cb;
          return ch;
        },
      };
      return ch;
    },
    removeChannel: (ch: unknown) => removeChannel(ch),
  },
}));

const { startSubscriptionPlanNudge } = await import("./subscriptionRealtimeNudge");

beforeEach(() => {
  removeChannel.mockClear();
  channelTopics.length = 0;
  tableHandlers.clear();
  statusHandler = null;
  channelThrows = false;
  onThrows = false;
});

describe("subscriptionRealtimeNudge — a doorbell, never a messenger", () => {
  it("signals on a change and never hands the row to the caller", () => {
    const seen: string[] = [];
    const stop = startSubscriptionPlanNudge((reason) => seen.push(reason));

    // Called with a payload, exactly as supabase-js would. The handler takes no
    // argument, so nothing about the changed row can reach the caller.
    tableHandlers.get("subscriptions")?.({
      eventType: "UPDATE",
      new: { plan_id: "plan-that-must-not-leak", status: "active" },
    });

    expect(seen).toEqual(["realtime"]);
    expect(seen.join(" ")).not.toContain("plan-that-must-not-leak");

    stop();
  });

  it("watches both tables that make up the effective plan", () => {
    const stop = startSubscriptionPlanNudge(() => {});
    expect([...tableHandlers.keys()].sort()).toEqual(["promotional_grants", "subscriptions"]);
    stop();
  });

  it("signals on a grant change too, since a grant moves the displayed plan", () => {
    const seen: string[] = [];
    const stop = startSubscriptionPlanNudge((reason) => seen.push(reason));

    tableHandlers.get("promotional_grants")?.({ eventType: "UPDATE" });

    expect(seen).toEqual(["realtime"]);
    stop();
  });

  it("signals on EVERY subscribe, to close the window before the socket opened", () => {
    const seen: string[] = [];
    const stop = startSubscriptionPlanNudge((reason) => seen.push(reason));

    statusHandler?.("SUBSCRIBED");
    statusHandler?.("CHANNEL_ERROR");
    statusHandler?.("SUBSCRIBED");

    // Two, not three: an error is not a reason to re-read, a (re)subscribe is.
    expect(seen).toEqual(["subscribed", "subscribed"]);
    stop();
  });

  it("removes the channel it created on teardown", () => {
    const stop = startSubscriptionPlanNudge(() => {});
    expect(removeChannel).not.toHaveBeenCalled();

    stop();

    // removeChannel, not unsubscribe: the house convention, and the one that takes
    // the channel off the client's list rather than leaving it there.
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("gives every start its own topic, so a fast restart cannot inherit a dying channel", () => {
    const stopA = startSubscriptionPlanNudge(() => {});
    const stopB = startSubscriptionPlanNudge(() => {});

    // supabase-js returns an EXISTING channel for a repeated topic, and removeChannel
    // awaits a network unsubscribe before forgetting it — so a fixed topic would hand
    // the second start a channel that is mid-teardown, and its handlers would be dead
    // or doubled. Observed in practice on a sign-out/sign-in, which re-runs the effect.
    expect(channelTopics).toHaveLength(2);
    expect(channelTopics[0]).not.toBe(channelTopics[1]);

    stopA();
    stopB();
  });

  it("returns a usable no-op teardown when the socket cannot be built", () => {
    channelThrows = true;
    const stop = startSubscriptionPlanNudge(() => {});

    expect(() => stop()).not.toThrow();
    // Nothing was created, so there is nothing to remove.
    expect(removeChannel).not.toHaveBeenCalled();
  });

  it("removes a channel that a later failure in the chain abandoned", () => {
    // `.channel()` succeeds and `.on()` then throws. The channel already exists on the
    // client's list at that point, so failing out silently would strand it there.
    onThrows = true;
    const seen: string[] = [];
    const stop = startSubscriptionPlanNudge((r) => seen.push(r));

    expect(channelTopics).toHaveLength(1);
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(() => stop()).not.toThrow();
    expect(seen).toEqual([]);
  });
});
